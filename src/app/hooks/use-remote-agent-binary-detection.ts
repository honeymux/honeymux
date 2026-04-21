/**
 * Polls remote tmux panes for running agent binaries and triggers the install
 * prompt flow for any (host, agent) pair where hooks are not yet installed and
 * the user has not already been asked this session.
 *
 * Mirrors `useAgentBinaryDetection` but parameterized by server and backed by
 * the RemoteInstallHost so the install-state check runs against the correct
 * remote filesystem.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { InstallHost } from "../../agents/install-host.ts";
import type { RemoteServerManager } from "../../remote/remote-server-manager.ts";
import type { AgentType } from "./agent-binary-detection-core.ts";

import { areClaudeHooksInstalled, isClaudeConsented, isClaudeIgnored } from "../../agents/claude/installer.ts";
import { areCodexHooksInstalled, isCodexConsented, isCodexIgnored } from "../../agents/codex/installer.ts";
import { areGeminiHooksInstalled, isGeminiConsented, isGeminiIgnored } from "../../agents/gemini/installer.ts";
import { isOpenCodeConsented, isOpenCodeIgnored, isOpenCodePluginInstalled } from "../../agents/opencode/installer.ts";
import { detectRemoteRunningAgentTypes } from "../../remote/agent-binary-detection.ts";
import { RemoteInstallHost } from "../../remote/remote-install-host.ts";

const POLL_INTERVAL_MS = 5000;

const AGENT_CHECKS: Record<
  AgentType,
  {
    isConsented: (hostId: string) => boolean;
    isIgnored: (hostId: string) => boolean;
    isInstalled: (host: InstallHost) => Promise<boolean>;
  }
> = {
  claude: {
    isConsented: (hostId) => isClaudeConsented(hostId),
    isIgnored: (hostId) => isClaudeIgnored(hostId),
    isInstalled: (host) => areClaudeHooksInstalled(host),
  },
  codex: {
    isConsented: (hostId) => isCodexConsented(hostId),
    isIgnored: (hostId) => isCodexIgnored(hostId),
    isInstalled: (host) => areCodexHooksInstalled(host),
  },
  gemini: {
    isConsented: (hostId) => isGeminiConsented(hostId),
    isIgnored: (hostId) => isGeminiIgnored(hostId),
    isInstalled: (host) => areGeminiHooksInstalled(host),
  },
  opencode: {
    isConsented: (hostId) => isOpenCodeConsented(hostId),
    isIgnored: (hostId) => isOpenCodeIgnored(hostId),
    isInstalled: (host) => isOpenCodePluginInstalled(host),
  },
};

export interface RemoteAgentBinaryDetectionApi {
  deferRemoteAgent: (agent: AgentType, hostId: string) => void;
  deferredRemoteAgents: RemoteDeferredAgent[];
  openDeferredRemoteDialog: (agent: AgentType, hostId: string) => void;
  undeferRemoteAgent: (agent: AgentType, hostId: string) => void;
}

export interface RemoteDeferredAgent {
  agent: AgentType;
  hostId: string;
}

interface UseRemoteAgentBinaryDetectionOptions {
  connected: boolean;
  remoteManagerRef: MutableRefObject<RemoteServerManager | null>;
  setClaudeDialogPending: Dispatch<SetStateAction<boolean>>;
  setCodexDialogPending: Dispatch<SetStateAction<boolean>>;
  setDialogHostId: Dispatch<SetStateAction<string | undefined>>;
  setDialogMode: Dispatch<SetStateAction<"install" | "upgrade">>;
  setGeminiDialogPending: Dispatch<SetStateAction<boolean>>;
  setOpenCodeDialogPending: Dispatch<SetStateAction<boolean>>;
}

export function useRemoteAgentBinaryDetection({
  connected,
  remoteManagerRef,
  setClaudeDialogPending,
  setCodexDialogPending,
  setDialogHostId,
  setDialogMode,
  setGeminiDialogPending,
  setOpenCodeDialogPending,
}: UseRemoteAgentBinaryDetectionOptions): RemoteAgentBinaryDetectionApi {
  const [deferredRemoteAgents, setDeferredRemoteAgents] = useState<RemoteDeferredAgent[]>([]);
  const promptedRef = useRef(new Set<string>());

  const setDialogForAgent = useCallback(
    (agent: AgentType, hostId: string, mode: "install" | "upgrade" = "install") => {
      setDialogHostId(hostId);
      setDialogMode(mode);
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
    [
      setClaudeDialogPending,
      setCodexDialogPending,
      setDialogHostId,
      setDialogMode,
      setGeminiDialogPending,
      setOpenCodeDialogPending,
    ],
  );

  const deferRemoteAgent = useCallback((agent: AgentType, hostId: string) => {
    promptedRef.current.add(promptedKey(agent, hostId));
    setDeferredRemoteAgents((prev) =>
      prev.some((entry) => entry.agent === agent && entry.hostId === hostId) ? prev : [...prev, { agent, hostId }],
    );
  }, []);

  const undeferRemoteAgent = useCallback((agent: AgentType, hostId: string) => {
    setDeferredRemoteAgents((prev) => prev.filter((entry) => !(entry.agent === agent && entry.hostId === hostId)));
  }, []);

  const openDeferredRemoteDialog = useCallback(
    (agent: AgentType, hostId: string) => {
      const manager = remoteManagerRef.current;
      const client = manager?.getConnectedClient(hostId);
      if (!client) {
        setDialogForAgent(agent, hostId);
        return;
      }
      const installHost = new RemoteInstallHost(hostId, {
        exec: (argv, options) => client.runRemoteShellCommand(argv, options),
      });
      void AGENT_CHECKS[agent]
        .isInstalled(installHost)
        .then((installed) => setDialogForAgent(agent, hostId, installed ? "upgrade" : "install"))
        .catch(() => setDialogForAgent(agent, hostId));
    },
    [remoteManagerRef, setDialogForAgent],
  );

  useEffect(() => {
    if (!connected) return;

    let cancelled = false;

    async function poll() {
      const manager = remoteManagerRef.current;
      if (!manager || cancelled) return;

      for (const serverName of manager.getConnectedServerNames()) {
        if (cancelled) return;
        const client = manager.getConnectedClient(serverName);
        if (!client) continue;

        const installHost = new RemoteInstallHost(serverName, {
          exec: (argv, options) => client.runRemoteShellCommand(argv, options),
        });

        let running: Set<AgentType>;
        try {
          running = await detectRemoteRunningAgentTypes({
            controlClient: client,
            exec: { exec: (argv, options) => client.runRemoteShellCommand(argv, options) },
          });
        } catch {
          continue;
        }
        if (cancelled) return;

        for (const agent of running) {
          const key = promptedKey(agent, serverName);
          if (promptedRef.current.has(key)) continue;

          const checks = AGENT_CHECKS[agent];
          if (checks.isIgnored(serverName)) continue;

          let installed: boolean;
          try {
            installed = await checks.isInstalled(installHost);
          } catch {
            // If the install check fails (SSH flake, etc.), skip this poll round.
            continue;
          }
          if (cancelled) return;
          // Installed + consent recorded for this remote → nothing to do.
          // Installed + no consent → prompt to upgrade.
          if (installed && checks.isConsented(serverName)) continue;

          promptedRef.current.add(key);
          setDialogForAgent(agent, serverName, installed ? "upgrade" : "install");
          return; // One dialog at a time across all hosts, like the local flow.
        }
      }
    }

    const initialTimer = setTimeout(poll, 2000);
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(id);
    };
  }, [connected, remoteManagerRef, setDialogForAgent]);

  return {
    deferRemoteAgent,
    deferredRemoteAgents,
    openDeferredRemoteDialog,
    undeferRemoteAgent,
  };
}

function promptedKey(agent: AgentType, hostId: string): string {
  return `${hostId}\u0000${agent}`;
}
