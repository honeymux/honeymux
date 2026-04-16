import { useCallback, useRef } from "react";

import type { HistoryEntry } from "../../agents/history-search.ts";
import type { AgentSession } from "../../agents/types.ts";
import type { PaneTabsApi } from "../pane-tabs/use-pane-tabs.ts";
import type { AgentBinaryDetectionApi } from "./use-agent-binary-detection.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";
import type { AgentDialogState, TmuxSessionState } from "./use-app-state-groups.ts";
import type { HistoryWorkflowApi } from "./use-history-workflow.ts";
import type { UiActionsApi } from "./use-ui-actions.ts";

import { ClaudeHookProvider } from "../../agents/claude/hook-provider.ts";
import { installClaudeHooks, saveClaudeConsent, saveClaudeIgnored } from "../../agents/claude/installer.ts";
import { CodexHookProvider } from "../../agents/codex/hook-provider.ts";
import { installCodexHooks, saveCodexConsent, saveCodexIgnored } from "../../agents/codex/installer.ts";
import { GeminiHookProvider } from "../../agents/gemini/hook-provider.ts";
import { installGeminiHooks, saveGeminiConsent, saveGeminiIgnored } from "../../agents/gemini/installer.ts";
import { getResumeArgs } from "../../agents/history-search.ts";
import { installOpenCodePlugin, saveOpenCodeConsent, saveOpenCodeIgnored } from "../../agents/opencode/installer.ts";
import { OpenCodePluginProvider } from "../../agents/opencode/plugin-provider.ts";
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
  tmuxSessionState: TmuxSessionState;
  uiActions: UiActionsApi;
}

export function useAgentActions({
  agentDetection,
  agentDialogState,
  historyWorkflow,
  paneTabsApi,
  refs,
  tmuxSessionState,
  uiActions,
}: UseAgentActionsOptions): AgentActionsApi {
  const { clientRef, dropdownInputRef, registryRef, storeRef, treeAgentSelectRef } = refs;
  const { currentSessionName } = tmuxSessionState;
  const {
    agentSessions,
    overlayOpenRef,
    quickTerminalMenuCloseRef,
    quickTerminalOpenRef,
    setAgentsDialogOpen,
    setClaudeDialogPending,
    setCodexDialogPending,
    setDialogSelected,
    setGeminiDialogPending,
    setOpenCodeDialogPending,
    setQuickTerminalOpen,
  } = agentDialogState;
  const { closeConversationsDialog } = historyWorkflow;
  const { handleSessionSelect } = uiActions;
  const { getPaneTabGroup, handleSwitchPaneTab } = paneTabsApi;
  const { deferAgent, undeferAgent } = agentDetection;
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
            await client.selectPane(session.paneId).catch(() => {});
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
              await client.selectPane(session.paneId).catch(() => {});
            }
          })();
        }
      }
    },
    [
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
      if (session?.isRemote) {
        refs.remoteManagerRef.current?.respondToPermission(sessionId, toolUseId, decision, session.paneId);
        storeRef.current?.markAnswered(sessionId);
        return;
      }
      const agentType = session?.agentType;
      let provider: ClaudeHookProvider | GeminiHookProvider | OpenCodePluginProvider | undefined;
      if (agentType === "opencode") {
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

  const handleClaudeInstall = useCallback(async () => {
    log("consent", "agent hooks: claude install accepted");
    setClaudeDialogPending(false);
    setDialogSelected("install");
    undeferAgent("claude");
    const success = await installClaudeHooks();
    const client = clientRef.current;
    if (success && client) {
      const registry = registryRef.current;
      if (registry) {
        const hookProvider = new ClaudeHookProvider(client);
        registry.register(hookProvider);
        hookProvider.start();
      }
    }
  }, [clientRef, registryRef, setClaudeDialogPending, setDialogSelected, undeferAgent]);

  const handleClaudeSkip = useCallback(async () => {
    setClaudeDialogPending(false);
    setDialogSelected("install");
    await saveClaudeConsent(false);
    deferAgent("claude");
  }, [deferAgent, setClaudeDialogPending, setDialogSelected]);

  const handleClaudeNever = useCallback(async () => {
    log("consent", "agent hooks: claude install rejected");
    setClaudeDialogPending(false);
    setDialogSelected("install");
    await saveClaudeIgnored();
    undeferAgent("claude");
  }, [setClaudeDialogPending, setDialogSelected, undeferAgent]);

  const handleOpenCodeInstall = useCallback(async () => {
    log("consent", "agent hooks: opencode install accepted");
    setOpenCodeDialogPending(false);
    setDialogSelected("install");
    undeferAgent("opencode");
    const success = await installOpenCodePlugin();
    const client = clientRef.current;
    if (success && client) {
      const registry = registryRef.current;
      if (registry) {
        const openCodeProvider = new OpenCodePluginProvider(client);
        registry.register(openCodeProvider);
        openCodeProvider.start();
      }
    }
  }, [clientRef, registryRef, setDialogSelected, setOpenCodeDialogPending, undeferAgent]);

  const handleOpenCodeSkip = useCallback(async () => {
    setOpenCodeDialogPending(false);
    setDialogSelected("install");
    await saveOpenCodeConsent(false);
    deferAgent("opencode");
  }, [deferAgent, setDialogSelected, setOpenCodeDialogPending]);

  const handleOpenCodeNever = useCallback(async () => {
    log("consent", "agent hooks: opencode install rejected");
    setOpenCodeDialogPending(false);
    setDialogSelected("install");
    await saveOpenCodeIgnored();
    undeferAgent("opencode");
  }, [setDialogSelected, setOpenCodeDialogPending, undeferAgent]);

  const handleGeminiInstall = useCallback(async () => {
    log("consent", "agent hooks: gemini install accepted");
    setGeminiDialogPending(false);
    setDialogSelected("install");
    undeferAgent("gemini");
    const success = await installGeminiHooks();
    const client = clientRef.current;
    if (success && client) {
      const registry = registryRef.current;
      if (registry) {
        const geminiProvider = new GeminiHookProvider(client);
        registry.register(geminiProvider);
        geminiProvider.start();
      }
    }
  }, [clientRef, registryRef, setDialogSelected, setGeminiDialogPending, undeferAgent]);

  const handleGeminiSkip = useCallback(async () => {
    setGeminiDialogPending(false);
    setDialogSelected("install");
    await saveGeminiConsent(false);
    deferAgent("gemini");
  }, [deferAgent, setDialogSelected, setGeminiDialogPending]);

  const handleGeminiNever = useCallback(async () => {
    log("consent", "agent hooks: gemini install rejected");
    setGeminiDialogPending(false);
    setDialogSelected("install");
    await saveGeminiIgnored();
    undeferAgent("gemini");
  }, [setDialogSelected, setGeminiDialogPending, undeferAgent]);

  const handleCodexInstall = useCallback(async () => {
    log("consent", "agent hooks: codex install accepted");
    setCodexDialogPending(false);
    setDialogSelected("install");
    undeferAgent("codex");
    const success = await installCodexHooks();
    const client = clientRef.current;
    if (success && client) {
      const registry = registryRef.current;
      if (registry) {
        const codexProvider = new CodexHookProvider(client);
        registry.register(codexProvider);
        codexProvider.start();
      }
    }
  }, [clientRef, registryRef, setCodexDialogPending, setDialogSelected, undeferAgent]);

  const handleCodexSkip = useCallback(async () => {
    setCodexDialogPending(false);
    setDialogSelected("install");
    await saveCodexConsent(false);
    deferAgent("codex");
  }, [deferAgent, setCodexDialogPending, setDialogSelected]);

  const handleCodexNever = useCallback(async () => {
    log("consent", "agent hooks: codex install rejected");
    setCodexDialogPending(false);
    setDialogSelected("install");
    await saveCodexIgnored();
    undeferAgent("codex");
  }, [setCodexDialogPending, setDialogSelected, undeferAgent]);

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
