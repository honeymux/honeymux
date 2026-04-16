import { useEffect, useMemo } from "react";

import type { AgentEvent } from "../../agents/types.ts";
import type { RemoteServerConfig } from "../../remote/types.ts";
import type { AppRuntimeRefs } from "./use-app-runtime-refs.ts";

import { RemoteServerManager } from "../../remote/remote-server-manager.ts";

interface UseRemoteManagerOptions {
  clearSshErrors: () => void;
  connected: boolean;
  handleSshServerStatusChange: (serverName: string, status: string, error?: string) => void;
  refs: Pick<AppRuntimeRefs, "clientRef" | "registryRef" | "remoteManagerRef">;
  remoteConfigs: RemoteServerConfig[] | undefined;
}

export function getRemoteConfigKey(remoteConfigs: RemoteServerConfig[] | undefined): string {
  return JSON.stringify(remoteConfigs ?? null);
}

export function shouldStartRemoteManager(
  connected: boolean,
  remoteConfigs: RemoteServerConfig[] | undefined,
): remoteConfigs is RemoteServerConfig[] {
  return connected && !!remoteConfigs?.length;
}

export function useRemoteManager({
  clearSshErrors,
  connected,
  handleSshServerStatusChange,
  refs,
  remoteConfigs,
}: UseRemoteManagerOptions): void {
  const remoteConfigKey = getRemoteConfigKey(remoteConfigs);
  const stableRemoteConfigs = useMemo(() => remoteConfigs, [remoteConfigKey]);

  useEffect(() => {
    if (!shouldStartRemoteManager(connected, stableRemoteConfigs)) {
      void refs.remoteManagerRef.current?.stopAll();
      refs.remoteManagerRef.current = null;
      clearSshErrors();
      return;
    }

    const client = refs.clientRef.current;
    if (!client) return;

    const manager = new RemoteServerManager(client, stableRemoteConfigs);
    refs.remoteManagerRef.current = manager;
    manager.on("server-status-change", handleSshServerStatusChange);
    const forwardAgentEvent = (event: AgentEvent) => {
      refs.registryRef.current?.forwardEvent(event);
    };
    manager.on("agent-event", forwardAgentEvent);
    manager.startAll().catch(() => {});

    return () => {
      manager.off("agent-event", forwardAgentEvent);
      manager.off("server-status-change", handleSshServerStatusChange);
      void manager.stopAll();
      if (refs.remoteManagerRef.current === manager) {
        refs.remoteManagerRef.current = null;
      }
      clearSshErrors();
    };
  }, [
    clearSshErrors,
    connected,
    handleSshServerStatusChange,
    refs.clientRef,
    refs.registryRef,
    refs.remoteManagerRef,
    stableRemoteConfigs,
  ]);
}
