import { useCallback, useRef } from "react";

import type { HistoryEntry } from "../../agents/history-search.ts";
import type { InstallHost } from "../../agents/install-host.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AgentBinaryDetectionApi } from "./use-agent-binary-detection.ts";
import type { AgentType } from "./use-agent-binary-detection.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { AgentDialogState, TmuxSessionState } from "./use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "./use-history-workflow.ts";
import type { RemoteAgentBinaryDetectionApi } from "./use-remote-agent-binary-detection.ts";
import type { UiActionsApi } from "./use-ui-actions.ts";

import { ClaudeHookProvider } from "../../agents/claude/hook-provider.ts";
import { installClaudeHooks, saveClaudeConsent, saveClaudeIgnored } from "../../agents/claude/installer.ts";
import { CodexHookProvider } from "../../agents/codex/hook-provider.ts";
import { installCodexHooks, saveCodexConsent, saveCodexIgnored } from "../../agents/codex/installer.ts";
import { GeminiHookProvider } from "../../agents/gemini/hook-provider.ts";
import { installGeminiHooks, saveGeminiConsent, saveGeminiIgnored } from "../../agents/gemini/installer.ts";
import { getResumeArgs } from "../../agents/history-search.ts";
import { localInstallHost } from "../../agents/install-host.ts";
import { installOpenCodePlugin, saveOpenCodeConsent, saveOpenCodeIgnored } from "../../agents/opencode/installer.ts";
import { OpenCodePluginProvider } from "../../agents/opencode/plugin-provider.ts";
import { AGENT_SUPPORTS_HOOK_DECISIONS } from "../../agents/types.ts";
import { RemoteInstallHost } from "../../remote/remote-install-host.ts";
import { log } from "../../util/log.ts";

export interface AgentActionsApi {
  handleAgentsDialogSelect: (session: AgentSession) => void;
  handleClaudeInstall: () => Promise<void>;
  handleClaudeNever: () => Promise<void>;
  handleClaudeSkip: () => Promise<void>;
  handleCodexInstall: () => Promise<void>;
  handleCodexNever: () => Promise<void>;
  handleCodexSkip: () => Promise<void>;
  handleConversationsSelect: (entry: HistoryEntry | undefined) => void;
  handleGeminiInstall: () => Promise<void>;
  handleGeminiNever: () => Promise<void>;
  handleGeminiSkip: () => Promise<void>;
  handleGoToPane: (session: AgentSession) => void;
  handleOpenAgentsDialog: () => void;
  handleOpenCodeInstall: () => Promise<void>;
  handleOpenCodeNever: () => Promise<void>;
  handleOpenCodeSkip: () => Promise<void>;
  handleOpenQuickTerminal: () => void;
  handlePermissionRespond: (sessionId: string, toolUseId: string, decision: "allow" | "deny") => void;
  handleQuickTerminalClose: () => void;
  handleQuickTerminalPinToWindow: (tempSessionName: string) => void;
}

interface UseAgentActionsOptions {
  agentDetection: AgentBinaryDetectionApi;
  agentDialogState: AgentDialogState;
  historyWorkflow: HistoryWorkflowApi;
  paneTabsApi: PaneTabsApi;
  refs: AppRuntimeRefs;
  remoteAgentDetection: RemoteAgentBinaryDetectionApi;
  tmuxSessionState: TmuxSessionState;
  uiActions: UiActionsApi;
}

export function useAgentActions({
  agentDetection,
  agentDialogState,
  historyWorkflow,
  paneTabsApi,
  refs,
  remoteAgentDetection,
  tmuxSessionState,
  uiActions,
}: UseAgentActionsOptions): AgentActionsApi {
  const {
    activePaneIdRef,
    clientRef,
    dropdownInputRef,
    handlePermissionRespondRef,
    registryRef,
    remoteManagerRef,
    storeRef,
    treeAgentSelectRef,
  } = refs;
  const { currentSessionName } = tmuxSessionState;
  const {
    agentSessions,
    dialogHostId,
    overlayOpenRef,
    quickTerminalMenuCloseRef,
    quickTerminalOpenRef,
    setAgentsDialogOpen,
    setClaudeDialogPending,
    setCodexDialogPending,
    setDialogHostId,
    setDialogMode,
    setDialogSelected,
    setGeminiDialogPending,
    setOpenCodeDialogPending,
    setQuickTerminalOpen,
  } = agentDialogState;
  const dialogHostIdRef = useRef(dialogHostId);
  dialogHostIdRef.current = dialogHostId;

  const resolveInstallHost = useCallback(
    (hostId: string | undefined): InstallHost | null => {
      if (!hostId || hostId === "local") return localInstallHost;
      const client = remoteManagerRef.current?.getConnectedClient(hostId);
      if (!client) return null;
      return new RemoteInstallHost(hostId, {
        exec: (argv, options) => client.runRemoteShellCommand(argv, options),
      });
    },
    [remoteManagerRef],
  );

  const undeferForHost = useCallback(
    (agent: AgentType, hostId: string | undefined) => {
      if (!hostId || hostId === "local") {
        agentDetection.undeferAgent(agent);
      } else {
        remoteAgentDetection.undeferRemoteAgent(agent, hostId);
      }
    },
    [agentDetection, remoteAgentDetection],
  );

  const deferForHost = useCallback(
    (agent: AgentType, hostId: string | undefined) => {
      if (!hostId || hostId === "local") {
        agentDetection.deferAgent(agent);
      } else {
        remoteAgentDetection.deferRemoteAgent(agent, hostId);
      }
    },
    [agentDetection, remoteAgentDetection],
  );
  const { closeConversationsDialog } = historyWorkflow;
  const { handleSessionSelect } = uiActions;
  const { getPaneTabGroup, handleSwitchPaneTab } = paneTabsApi;
  const agentSessionsRef = useRef<AgentSession[]>(agentSessions);
  agentSessionsRef.current = agentSessions;

  // The shared Agents action opens the agents dialog.
  const handleOpenAgentsDialog = useCallback(() => {
    setAgentsDialogOpen(true);
  }, [setAgentsDialogOpen]);

  const handleAgentsDialogSelect = useCallback(
    (session: AgentSession) => {
      dropdownInputRef.current = null;
      setAgentsDialogOpen(false);
      // Hand off to the zoom hook so the muxotron latches the interactive
      // PTY surface onto this agent.
      treeAgentSelectRef.current?.(session);
    },
    [dropdownInputRef, setAgentsDialogOpen, treeAgentSelectRef],
  );

  const handleGoToPane = useCallback(
    (session: AgentSession) => {
      if (!session.paneId) return;
      dropdownInputRef.current = null;
      setAgentsDialogOpen(false);

      // If the agent's pane is in a non-active tab, switch to that tab first
      // so the pane moves from the staging window into the visible window.
      // We must do this BEFORE selectPane — selecting a pane that lives in the
      // staging window would cause tmux to redirect PTY output there, showing
      // stale/wrong content.
      const switchToTab = async (paneId: string) => {
        const group = getPaneTabGroup(paneId);
        if (group) {
          const tabIndex = group.tabs.findIndex((t) => t.paneId === paneId);
          if (tabIndex >= 0 && tabIndex !== group.activeIndex) {
            await handleSwitchPaneTab(group.slotKey, tabIndex);
          }
        }
      };

      const targetSession = session.sessionName;
      if (targetSession && targetSession !== currentSessionName) {
        // Different tmux session — use the full session switch flow
        handleSessionSelect(targetSession).then(async () => {
          const client = clientRef.current;
          if (!client) return;
          if (session.windowId) await client.selectWindow(session.windowId).catch(() => {});
          if (session.paneId) {
            await switchToTab(session.paneId);
            const paneSelected = await client
              .selectPane(session.paneId)
              .then(() => true)
              .catch(() => false);
            if (paneSelected) {
              activePaneIdRef.current = session.paneId;
            }
          }
        });
      } else {
        // Same session — use control client for window/pane selection
        const client = clientRef.current;
        if (client) {
          (async () => {
            if (session.windowId) await client.selectWindow(session.windowId).catch(() => {});
            if (session.paneId) {
              await switchToTab(session.paneId);
              const paneSelected = await client
                .selectPane(session.paneId)
                .then(() => true)
                .catch(() => false);
              if (paneSelected) {
                activePaneIdRef.current = session.paneId;
              }
            }
          })();
        }
      }
    },
    [
      activePaneIdRef,
      clientRef,
      currentSessionName,
      dropdownInputRef,
      getPaneTabGroup,
      handleSessionSelect,
      handleSwitchPaneTab,
      setAgentsDialogOpen,
    ],
  );

  const handleConversationsSelect = useCallback(
    (entry: HistoryEntry | undefined) => {
      if (!entry) return;
      closeConversationsDialog();

      // Check for already-running session with matching agentType + sessionId
      const running = entry.sessionId
        ? agentSessionsRef.current.find((s) => s.agentType === entry.agentType && s.sessionId === entry.sessionId)
        : undefined;

      if (running) {
        handleGoToPane(running);
        return;
      }

      // Spawn new window with validated argv resume command (or bare agent)
      const resumeArgs = getResumeArgs(entry);
      const spawnArgs = resumeArgs ?? [entry.agentType];
      const client = clientRef.current;
      if (!client) return;
      const args = ["new-window", "-t", currentSessionName];
      if (entry.project) args.push("-c", entry.project);
      args.push("--", ...spawnArgs);
      client.runCommandArgs(args).catch(() => {});
    },
    [clientRef, closeConversationsDialog, currentSessionName, handleGoToPane],
  );

  const handlePermissionRespond = useCallback(
    (sessionId: string, toolUseId: string, decision: "allow" | "deny") => {
      const registry = registryRef.current;
      if (!registry) {
        return;
      }

      // Route to correct provider based on agent type
      const session = storeRef.current?.getSession(sessionId);
      // Codex and Gemini run their hooks fire-and-forget; honeymux can't
      // actually decide the request, so we treat allow/deny as no-ops for
      // those agents (the UI already hides those buttons, but hotkeys can
      // still fire). Bailing here keeps the local alert visible until the
      // user answers the agent's own in-pane prompt or explicitly dismisses.
      if (session && !AGENT_SUPPORTS_HOOK_DECISIONS[session.agentType]) {
        return;
      }
      if (session?.isRemote) {
        refs.remoteManagerRef.current?.respondToPermission(sessionId, toolUseId, decision, session.paneId);
        storeRef.current?.markAnswered(sessionId);
        return;
      }
      const agentType = session?.agentType;
      let provider: ClaudeHookProvider | CodexHookProvider | GeminiHookProvider | OpenCodePluginProvider | undefined;
      if (agentType === "codex") {
        provider = registry.getProvider("codex-hook") as CodexHookProvider | undefined;
      } else if (agentType === "opencode") {
        provider = registry.getProvider("opencode-plugin") as OpenCodePluginProvider | undefined;
      } else if (agentType === "gemini") {
        provider = registry.getProvider("gemini-hook") as GeminiHookProvider | undefined;
      } else {
        provider = registry.getProvider("claude-hook") as ClaudeHookProvider | undefined;
      }
      if (!provider) {
        return;
      }
      provider.respondToPermission(sessionId, toolUseId, decision);
      // Immediately transition session out of unanswered so the UI updates
      storeRef.current?.markAnswered(sessionId);
    },
    [registryRef, storeRef],
  );
  handlePermissionRespondRef.current = handlePermissionRespond;

  const handleClaudeInstall = useCallback(async () => {
    const hostId = dialogHostIdRef.current;
    log("consent", `agent hooks: claude install accepted (host=${hostId ?? "local"})`);
    setClaudeDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    undeferForHost("claude", hostId);
    const host = resolveInstallHost(hostId);
    if (!host) return;
    const success = await installClaudeHooks(host);
    if (!success) return;
    // Local pane hook provider only applies to local installs; remote agent
    // events are delivered via the per-server remote ingress socket.
    if (host.hostId !== "local") return;
    const client = clientRef.current;
    const registry = registryRef.current;
    if (client && registry) {
      const hookProvider = new ClaudeHookProvider(client);
      registry.register(hookProvider);
      hookProvider.start();
    }
  }, [
    clientRef,
    registryRef,
    resolveInstallHost,
    setClaudeDialogPending,
    setDialogHostId,
    setDialogMode,
    setDialogSelected,
    undeferForHost,
  ]);

  const handleClaudeSkip = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    setClaudeDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveClaudeConsent(false, hostId);
    deferForHost("claude", hostId);
  }, [deferForHost, setClaudeDialogPending, setDialogHostId, setDialogMode, setDialogSelected]);

  const handleClaudeNever = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    log("consent", `agent hooks: claude install rejected (host=${hostId})`);
    setClaudeDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveClaudeIgnored(hostId);
    undeferForHost("claude", hostId);
  }, [setClaudeDialogPending, setDialogHostId, setDialogMode, setDialogSelected, undeferForHost]);

  const handleOpenCodeInstall = useCallback(async () => {
    const hostId = dialogHostIdRef.current;
    log("consent", `agent hooks: opencode install accepted (host=${hostId ?? "local"})`);
    setOpenCodeDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    undeferForHost("opencode", hostId);
    const host = resolveInstallHost(hostId);
    if (!host) return;
    const success = await installOpenCodePlugin(host);
    if (!success) return;
    if (host.hostId !== "local") return;
    const client = clientRef.current;
    const registry = registryRef.current;
    if (client && registry) {
      const openCodeProvider = new OpenCodePluginProvider(client);
      registry.register(openCodeProvider);
      openCodeProvider.start();
    }
  }, [
    clientRef,
    registryRef,
    resolveInstallHost,
    setDialogHostId,
    setDialogMode,
    setDialogSelected,
    setOpenCodeDialogPending,
    undeferForHost,
  ]);

  const handleOpenCodeSkip = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    setOpenCodeDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveOpenCodeConsent(false, hostId);
    deferForHost("opencode", hostId);
  }, [deferForHost, setDialogHostId, setDialogMode, setDialogSelected, setOpenCodeDialogPending]);

  const handleOpenCodeNever = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    log("consent", `agent hooks: opencode install rejected (host=${hostId})`);
    setOpenCodeDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveOpenCodeIgnored(hostId);
    undeferForHost("opencode", hostId);
  }, [setDialogHostId, setDialogMode, setDialogSelected, setOpenCodeDialogPending, undeferForHost]);

  const handleGeminiInstall = useCallback(async () => {
    const hostId = dialogHostIdRef.current;
    log("consent", `agent hooks: gemini install accepted (host=${hostId ?? "local"})`);
    setGeminiDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    undeferForHost("gemini", hostId);
    const host = resolveInstallHost(hostId);
    if (!host) return;
    const success = await installGeminiHooks(host);
    if (!success) return;
    if (host.hostId !== "local") return;
    const client = clientRef.current;
    const registry = registryRef.current;
    if (client && registry) {
      const geminiProvider = new GeminiHookProvider(client);
      registry.register(geminiProvider);
      geminiProvider.start();
    }
  }, [
    clientRef,
    registryRef,
    resolveInstallHost,
    setDialogHostId,
    setDialogMode,
    setDialogSelected,
    setGeminiDialogPending,
    undeferForHost,
  ]);

  const handleGeminiSkip = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    setGeminiDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveGeminiConsent(false, hostId);
    deferForHost("gemini", hostId);
  }, [deferForHost, setDialogHostId, setDialogMode, setDialogSelected, setGeminiDialogPending]);

  const handleGeminiNever = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    log("consent", `agent hooks: gemini install rejected (host=${hostId})`);
    setGeminiDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveGeminiIgnored(hostId);
    undeferForHost("gemini", hostId);
  }, [setDialogHostId, setDialogMode, setDialogSelected, setGeminiDialogPending, undeferForHost]);

  const handleCodexInstall = useCallback(async () => {
    const hostId = dialogHostIdRef.current;
    log("consent", `agent hooks: codex install accepted (host=${hostId ?? "local"})`);
    setCodexDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    undeferForHost("codex", hostId);
    const host = resolveInstallHost(hostId);
    if (!host) return;
    const success = await installCodexHooks(host);
    if (!success) return;
    if (host.hostId !== "local") return;
    const client = clientRef.current;
    const registry = registryRef.current;
    if (client && registry) {
      const codexProvider = new CodexHookProvider(client);
      registry.register(codexProvider);
      codexProvider.start();
    }
  }, [
    clientRef,
    registryRef,
    resolveInstallHost,
    setCodexDialogPending,
    setDialogHostId,
    setDialogMode,
    setDialogSelected,
    undeferForHost,
  ]);

  const handleCodexSkip = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    setCodexDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveCodexConsent(false, hostId);
    deferForHost("codex", hostId);
  }, [deferForHost, setCodexDialogPending, setDialogHostId, setDialogMode, setDialogSelected]);

  const handleCodexNever = useCallback(async () => {
    const hostId = dialogHostIdRef.current ?? "local";
    log("consent", `agent hooks: codex install rejected (host=${hostId})`);
    setCodexDialogPending(false);
    setDialogHostId(undefined);
    setDialogMode("install");
    setDialogSelected("install");
    await saveCodexIgnored(hostId);
    undeferForHost("codex", hostId);
  }, [setCodexDialogPending, setDialogHostId, setDialogMode, setDialogSelected, undeferForHost]);

  const handleOpenQuickTerminal = useCallback(() => {
    // Set refs FIRST (synchronous, visible to input router immediately)
    // before any state setters that might trigger intermediate re-renders.
    quickTerminalOpenRef.current = true;
    overlayOpenRef.current = true;
    setQuickTerminalOpen(true);
  }, [overlayOpenRef, quickTerminalOpenRef, setQuickTerminalOpen]);

  const handleQuickTerminalClose = useCallback(() => {
    // If the overlay's dropdown menu is open, close that first
    if (quickTerminalMenuCloseRef.current) {
      quickTerminalMenuCloseRef.current();
      return;
    }
    setQuickTerminalOpen(false);
    quickTerminalOpenRef.current = false;
    overlayOpenRef.current = false;
  }, [overlayOpenRef, quickTerminalOpenRef, quickTerminalMenuCloseRef, setQuickTerminalOpen]);

  const handleQuickTerminalPinToWindow = useCallback(
    (tempSessionName: string) => {
      // Move the window from the temp session into the current session
      clientRef.current?.moveSessionWindowToSession(tempSessionName, currentSessionName).catch(() => {});
      setQuickTerminalOpen(false);
      quickTerminalOpenRef.current = false;
      overlayOpenRef.current = false;
    },
    [clientRef, currentSessionName, overlayOpenRef, quickTerminalOpenRef, setQuickTerminalOpen],
  );

  return {
    handleAgentsDialogSelect,
    handleClaudeInstall,
    handleClaudeNever,
    handleClaudeSkip,
    handleCodexInstall,
    handleCodexNever,
    handleCodexSkip,
    handleConversationsSelect,
    handleGeminiInstall,
    handleGeminiNever,
    handleGeminiSkip,
    handleGoToPane,
    handleOpenAgentsDialog,
    handleOpenCodeInstall,
    handleOpenCodeNever,
    handleOpenCodeSkip,
    handleOpenQuickTerminal,
    handlePermissionRespond,
    handleQuickTerminalClose,
    handleQuickTerminalPinToWindow,
  };
}
