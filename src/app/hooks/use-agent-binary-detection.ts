import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/**
 * Polls tmux panes for running agent binaries and manages the agent
 * integration prompt flow.
 *
 * When an agent binary (claude, codex, opencode, gemini) is detected
 * and its integration is not installed and not ignored, we either:
 *   - Auto-pop the agent install dialog (first detection)
 *   - Add to the deferred warning badge (after "Not Now")
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { TmuxControlClient } from "../../tmux/control-client.ts";

import { areClaudeHooksInstalled, isClaudeIgnored } from "../../agents/claude/installer.ts";
import { areCodexHooksInstalled, isCodexIgnored } from "../../agents/codex/installer.ts";
import { areGeminiHooksInstalled, isGeminiIgnored } from "../../agents/gemini/installer.ts";
import { isOpenCodeIgnored, isOpenCodePluginInstalled } from "../../agents/opencode/installer.ts";
import { type AgentType, detectRunningAgentTypes } from "./agent-binary-detection-core.ts";

export type { AgentType } from "./agent-binary-detection-core.ts";

export interface AgentBinaryInfo {
  displayName: string;
  installLabel: "hooks" | "plugin";
  isIgnored: () => boolean;
  isInstalled: () => boolean;
  type: AgentType;
}

const AGENTS: AgentBinaryInfo[] = [
  {
    displayName: "Claude Code",
    installLabel: "hooks",
    isIgnored: isClaudeIgnored,
    isInstalled: areClaudeHooksInstalled,
    type: "claude",
  },
  {
    displayName: "OpenCode",
    installLabel: "plugin",
    isIgnored: isOpenCodeIgnored,
    isInstalled: isOpenCodePluginInstalled,
    type: "opencode",
  },
  {
    displayName: "Gemini CLI",
    installLabel: "hooks",
    isIgnored: isGeminiIgnored,
    isInstalled: areGeminiHooksInstalled,
    type: "gemini",
  },
  {
    displayName: "Codex CLI",
    installLabel: "hooks",
    isIgnored: isCodexIgnored,
    isInstalled: areCodexHooksInstalled,
    type: "codex",
  },
];

const POLL_INTERVAL_MS = 5000;

export interface AgentBinaryDetectionApi {
  agents: AgentBinaryInfo[];
  deferAgent: (agent: AgentType) => void;
  deferredAgents: AgentType[];
  getAgentInfo: (type: AgentType) => AgentBinaryInfo | undefined;
  openDeferredDialog: (agent: AgentType) => void;
  undeferAgent: (agent: AgentType) => void;
}

interface UseAgentBinaryDetectionOptions {
  clientRef: MutableRefObject<TmuxControlClient | null>;
  connected: boolean;
  setClaudeDialogPending: Dispatch<SetStateAction<boolean>>;
  setCodexDialogPending: Dispatch<SetStateAction<boolean>>;
  setGeminiDialogPending: Dispatch<SetStateAction<boolean>>;
  setOpenCodeDialogPending: Dispatch<SetStateAction<boolean>>;
}

export function useAgentBinaryDetection({
  clientRef,
  connected,
  setClaudeDialogPending,
  setCodexDialogPending,
  setGeminiDialogPending,
  setOpenCodeDialogPending,
}: UseAgentBinaryDetectionOptions): AgentBinaryDetectionApi {
  // Agents the user chose "Not Now" for during this session
  const [deferredAgents, setDeferredAgents] = useState<AgentType[]>([]);
  // Agents we've already auto-popped a dialog for this session
  const promptedRef = useRef(new Set<AgentType>());

  const setDialogForAgent = useCallback(
    (agent: AgentType) => {
      switch (agent) {
        case "claude":
          setClaudeDialogPending(true);
          break;
        case "codex":
          setCodexDialogPending(true);
          break;
        case "gemini":
          setGeminiDialogPending(true);
          break;
        case "opencode":
          setOpenCodeDialogPending(true);
          break;
      }
    },
    [setClaudeDialogPending, setOpenCodeDialogPending, setGeminiDialogPending, setCodexDialogPending],
  );

  // Mark an agent as deferred ("Not Now")
  const deferAgent = useCallback((agent: AgentType) => {
    promptedRef.current.add(agent);
    setDeferredAgents((prev) => (prev.includes(agent) ? prev : [...prev, agent]));
  }, []);

  // Remove an agent from deferred (after install or ignore)
  const undeferAgent = useCallback((agent: AgentType) => {
    setDeferredAgents((prev) => prev.filter((a) => a !== agent));
  }, []);

  // Open the dialog for a deferred agent (from badge click)
  const openDeferredDialog = useCallback(
    (agent: AgentType) => {
      setDialogForAgent(agent);
    },
    [setDialogForAgent],
  );

  useEffect(() => {
    if (!connected) return;

    let cancelled = false;

    async function poll() {
      const client = clientRef.current;
      if (!client || cancelled) return;

      try {
        const output = await client.runCommand("list-panes -a -F '#{pane_current_command}\t#{pane_pid}\t#{pane_tty}'");
        if (cancelled) return;
        const running = detectRunningAgentTypes(output);

        // For each running agent: check if we should show a dialog
        for (const agentType of running) {
          const info = AGENTS.find((a) => a.type === agentType);
          if (!info) continue;

          // Already installed or ignored → skip
          if (info.isInstalled() || info.isIgnored()) continue;

          // Already prompted this session → stays in deferred
          if (promptedRef.current.has(agentType)) continue;

          // Auto-pop dialog
          promptedRef.current.add(agentType);
          setDialogForAgent(agentType);
          break; // Only pop one at a time
        }
      } catch {
        // Graceful degradation
      }
    }

    // Initial poll after a short delay to let the UI settle
    const initialTimer = setTimeout(poll, 2000);
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(id);
    };
  }, [clientRef, connected, setDialogForAgent]);

  return {
    agents: AGENTS,
    deferAgent,
    deferredAgents,
    /** Lookup helper for agent display info */
    getAgentInfo: (type: AgentType) => AGENTS.find((a) => a.type === type),
    openDeferredDialog,
    undeferAgent,
  };
}
