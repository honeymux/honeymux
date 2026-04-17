import type { AgentSession, HookSnifferEntry } from "../../agents/types.ts";
import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { TmuxWindow } from "../../tmux/types.ts";
import type { SetupTmuxRuntimeContext } from "./runtime-context.ts";

import { ClaudeHookProvider } from "../../agents/claude/hook-provider.ts";
import { areClaudeHooksInstalled, refreshClaudeHooksIfConsented } from "../../agents/claude/installer.ts";
import { CodexHookProvider } from "../../agents/codex/hook-provider.ts";
import { areCodexHooksInstalled, refreshCodexHooksIfConsented } from "../../agents/codex/installer.ts";
import { GeminiHookProvider } from "../../agents/gemini/hook-provider.ts";
import { areGeminiHooksInstalled, refreshGeminiHooksIfConsented } from "../../agents/gemini/installer.ts";
import { isOpenCodePluginInstalled, refreshOpenCodePluginIfConsented } from "../../agents/opencode/installer.ts";
import { OpenCodePluginProvider } from "../../agents/opencode/plugin-provider.ts";
import { AgentProviderRegistry } from "../../agents/provider.ts";
import { AgentSessionStore } from "../../agents/session-store.ts";
import { TeamService } from "../../agents/teams/index.ts";
import { DEFAULT_SCHEME, getNextSessionColor } from "../../themes/theme.ts";
import { loadConfig } from "../../util/config.ts";
import { buildHookSnifferEntry } from "./hook-sniffer-entry.ts";

export interface BootstrapConnectedSessionOptions {
  applyPendingRenames: (windows: TmuxWindow[]) => void;
  client: TmuxControlClient;
  ctx: SetupTmuxRuntimeContext;
  targetSession: string;
}

export interface BootstrapConnectedSessionResult {
  clearKeybindingRefresh: () => void;
}

export function bootstrapConnectedSession({
  applyPendingRenames,
  client,
  ctx,
  targetSession,
}: BootstrapConnectedSessionOptions): BootstrapConnectedSessionResult {
  const {
    agentRuntime: {
      activePaneIdRef,
      muxotronExpandedRef,
      registryRef,
      setAgentSessions,
      setHookSnifferEvents,
      storeRef,
      uiModeRef,
    },
    configRuntime: { setConfig, setConfigThemeBuiltin, setConfigThemeMode, setConfigUIMode },
    sessionRuntime: { deferredSessionRef, inputReady, spawnPtyBridge, tooNarrowRef },
    sessionState: { setActiveIndex, setConnected, setKeyBindings, setStatusBarInfo, setWindows },
  } = ctx;

  let kbIntervalId: ReturnType<typeof setInterval> | undefined;
  let teamServiceInstance: TeamService | undefined;

  (async () => {
    try {
      const initialConfig = loadConfig();
      // Use the outer terminal's dims (process.stdout) rather than pane-
      // content dims so the control client is always >= the PTY client.
      // With `window-size smallest` this keeps the window size pinned to the
      // PTY (pane) rather than having the control-client act as a ceiling.
      // process.stdout is reliable from process start, unlike dimsRef which
      // may still be at its initial placeholder when this runs.
      const cols = process.stdout.columns ?? 80;
      const rows = process.stdout.rows ?? 24;
      await client.connect(targetSession, { cols, rows });

      setConnected(true);

      // Fetch initial session list (for badge color display).
      // Backfill @hmx-color on any session that doesn't have one yet so that
      // every session has a stable, persistent color from the start.
      const { setSessions } = ctx.sessionState;
      client
        .listSessions()
        .then(async (sessions) => {
          const uncolored = sessions.filter((s) => !s.color);
          if (uncolored.length > 0) {
            for (const s of uncolored) {
              const others = sessions.filter((x) => x.name !== s.name).map((x) => x.color);
              const color = getNextSessionColor(others);
              await client.setSessionColor(s.name, color);
              s.color = color;
            }
            sessions = await client.listSessions();
          }
          setSessions(sessions);
        })
        .catch(() => {});

      // Initialize agent provider system
      const store = new AgentSessionStore();
      storeRef.current = store;
      const registry = new AgentProviderRegistry();
      registryRef.current = registry;

      const teamService = new TeamService();
      teamService.start();
      teamServiceInstance = teamService;
      // When the config poller discovers new team configs, retroactively tag
      // existing sessions that were created before the config appeared on disk.
      teamService.on("configs-discovered", (configs) => {
        store.retroactivelyEnrichFromConfigs(configs);
      });
      // When we learn about team info via events (TeammateIdle/TaskCompleted),
      // retroactively enrich existing sessions that belong to that team
      teamService.on("team-info-learned", () => {
        const teams = teamService.getTeams();
        const configs = teams.map((t) => t.config);
        store.retroactivelyEnrichFromConfigs(configs);
      });
      const HOOK_SNIFFER_MAX = 256;
      registry.on("agent-event", (event) => {
        teamService.enrichEvent(event);
        store.handleEvent(event);

        // Accumulate for the hook sniffer view (ring buffer, max 256)
        const entry: HookSnifferEntry = buildHookSnifferEntry(event);
        setHookSnifferEvents((prev) => {
          const next = [...prev, entry];
          return next.length > HOOK_SNIFFER_MAX ? next.slice(next.length - HOOK_SNIFFER_MAX) : next;
        });
      });
      store.on("sessions-changed", (sessions: AgentSession[]) => {
        setAgentSessions(sessions);
        // Update muxotronEnabled expansion ref for non-React consumers (mouse mapper)
        const activePaneId = activePaneIdRef.current;
        const hasNonDismissedUnanswered = sessions.some(
          (s) => s.status === "unanswered" && !s.dismissed && s.paneId !== activePaneId,
        );
        const shouldExpand = hasNonDismissedUnanswered && uiModeRef.current === "adaptive";
        muxotronExpandedRef.current = shouldExpand;
      });
      store.startLivenessCheck();

      // One-shot at startup: refresh hook files for agents the user has
      // already consented to, so newer bundled versions replace stale scripts.
      // Agents without local consent are left alone; the normal install flow
      // (via useAgentBinaryDetection) will sync them when consent is granted.
      await Promise.all([
        refreshClaudeHooksIfConsented(),
        refreshCodexHooksIfConsented(),
        refreshGeminiHooksIfConsented(),
        refreshOpenCodePluginIfConsented(),
      ]);

      // Register hook providers for agents with hooks already installed.
      // Detection of agents that need hooks is handled by useAgentBinaryDetection.
      const [claudeInstalled, openCodeInstalled, geminiInstalled, codexInstalled] = await Promise.all([
        areClaudeHooksInstalled(),
        isOpenCodePluginInstalled(),
        areGeminiHooksInstalled(),
        areCodexHooksInstalled(),
      ]);

      if (claudeInstalled) {
        const hookProvider = new ClaudeHookProvider(client);
        registry.register(hookProvider);
      }

      if (openCodeInstalled) {
        const openCodeProvider = new OpenCodePluginProvider(client);
        registry.register(openCodeProvider);
      }

      if (geminiInstalled) {
        const geminiProvider = new GeminiHookProvider(client);
        registry.register(geminiProvider);
      }

      if (codexInstalled) {
        const codexProvider = new CodexHookProvider(client);
        registry.register(codexProvider);
      }

      registry.startAll();

      // Apply UI state from saved config (tmux options already applied above)
      if (initialConfig) {
        setConfig(initialConfig);
        setConfigThemeBuiltin(initialConfig.themeBuiltin ?? DEFAULT_SCHEME);
        setConfigThemeMode(initialConfig.themeMode ?? "built-in");
        // Toolbar starts closed (overlay, not persistent)
        setConfigUIMode(initialConfig.uiMode ?? "adaptive");
      } else {
        // First run — apply defaults
        setConfigThemeBuiltin(DEFAULT_SCHEME);
        setConfigThemeMode("built-in");
      }

      const initialWindows = await client.listWindows();
      applyPendingRenames(initialWindows);
      const visibleWindows = initialWindows.filter((w) => !w.name.startsWith("_hmx_"));
      setWindows(visibleWindows);
      const activeWin = visibleWindows.find((w) => w.active);
      if (activeWin) {
        setActiveIndex(visibleWindows.indexOf(activeWin));
      }

      // Load key bindings + status bar info, refresh periodically
      client
        .getKeyBindings()
        .then(setKeyBindings)
        .catch(() => {});
      client
        .getStatusBarInfo()
        .then(setStatusBarInfo)
        .catch(() => {});
      kbIntervalId = setInterval(() => {
        client
          .getKeyBindings()
          .then(setKeyBindings)
          .catch(() => {});
        client
          .getStatusBarInfo()
          .then(setStatusBarInfo)
          .catch(() => {});
      }, 5_000);

      // Spawn PTY bridge running tmux attach (defer if window too narrow)
      if (tooNarrowRef.current) {
        deferredSessionRef.current = targetSession;
        // Still enable input after settling delay so tooNarrow keypress handler works
        setTimeout(() => {
          inputReady.current = true;
        }, 200);
      } else {
        spawnPtyBridge(targetSession);
      }
    } catch {
      setConnected(false);
    }
  })();

  return {
    clearKeybindingRefresh: () => {
      clearInterval(kbIntervalId);
      teamServiceInstance?.destroy();
    },
  };
}
