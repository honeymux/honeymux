import type { SetupTmuxRuntimeContext } from "./runtime-context.ts";

import { TmuxControlClient } from "../../tmux/control-client.ts";
import { bootstrapConnectedSession } from "./bootstrap-connected-session.ts";
import { registerSessionEventHandlers } from "./register-session-event-handlers.ts";
import { setupInputLayer } from "./setup-input-layer.ts";

export type {
  RuntimeDims,
  SetupTmuxRuntimeAgentRuntimeContext,
  SetupTmuxRuntimeConfigRuntimeContext,
  SetupTmuxRuntimeContext,
  SetupTmuxRuntimeDialogsContext,
  SetupTmuxRuntimeInputContext,
  SetupTmuxRuntimeMouseContext,
  SetupTmuxRuntimeSessionRuntimeContext,
  SetupTmuxRuntimeSessionStateContext,
} from "./runtime-context.ts";

export function setupTmuxRuntime(ctx: SetupTmuxRuntimeContext): () => void {
  const {
    agentRuntime: { registryRef, storeRef },
    sessionRuntime: { clientRef, initTargetRef, ptyRef },
  } = ctx;

  const targetSession = initTargetRef.current;
  const client = new TmuxControlClient();
  clientRef.current = client;

  const cleanupInputLayer = setupInputLayer(ctx);

  // Wire up event listeners BEFORE connecting so we don't miss startup events.
  const { applyPendingRenames } = registerSessionEventHandlers(client, ctx);
  const { clearKeybindingRefresh } = bootstrapConnectedSession({
    applyPendingRenames,
    client,
    ctx,
    targetSession,
  });

  return () => {
    cleanupInputLayer();
    try {
      ptyRef.current?.kill();
    } catch {
      // ignore
    }
    clearKeybindingRefresh();
    registryRef.current?.stopAll();
    storeRef.current?.destroy();
    if (clientRef.current === client) {
      clientRef.current = null;
    }
    client.destroy();
  };
}
