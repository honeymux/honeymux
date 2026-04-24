import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { AgentAnimationConfig, AgentEvent, AgentType } from "../types.ts";

import { AgentProvider } from "../provider.ts";
import { HookSocketServer, getCodexSocketPath, loadPersistedSessions } from "../socket-server.ts";
import { TmuxTtyResolver } from "../tmux-tty-resolver.ts";
import { CODEX_ANIMATIONS } from "../types.ts";

export class CodexHookProvider extends AgentProvider {
  readonly animations: AgentAnimationConfig = CODEX_ANIMATIONS;
  readonly providerType = "codex-hook";
  readonly supportedAgents: AgentType[] = ["codex"];

  private socketServer: HookSocketServer;
  private ttyResolver: TmuxTtyResolver;

  constructor(client: TmuxControlClient) {
    super();
    // holdPermissionConnections=false: Codex runs hooks strictly before its
    // native approval UI, so any blocking here would hide the user's in-pane
    // prompt. The hook is fire-and-forget and we expose the event purely as
    // a notification; the user answers Codex directly in the pane.
    this.socketServer = new HookSocketServer(getCodexSocketPath(), false);
    this.ttyResolver = new TmuxTtyResolver(client);
  }

  /**
   * No-op for parity with other providers. The hook has already exited by the
   * time honeymux's dialog is visible, so there is no live socket to write a
   * decision back to. The authoritative decision is the one the user gives to
   * Codex directly in the pane. The muxotron strip hides allow/deny for codex
   * so this method is unreachable in normal flows; it exists as a defensive
   * stub if anything ever routes here.
   */
  respondToPermission(_sessionId: string, _toolUseId: string, _decision: "allow" | "deny"): void {
    // intentional no-op
  }

  start(): void {
    this.ttyResolver.start();
    this.socketServer.start();
    this.socketServer.on("event", (event: AgentEvent) => this.handleHookEvent(event));

    for (const event of loadPersistedSessions("codex")) {
      this.handleHookEvent(event);
    }
  }

  stop(): void {
    this.ttyResolver.stop();
    this.socketServer.stop();
  }

  private async applyTtyMapping(event: AgentEvent): Promise<void> {
    if (event.isRemote) return;

    const mapping = event.paneId
      ? await this.ttyResolver.resolvePaneId(event.paneId)
      : event.tty
        ? await this.ttyResolver.resolveTty(event.tty)
        : undefined;
    if (!mapping) return;

    event.paneId = mapping.paneId;
    event.sessionName = mapping.sessionName;
    event.tty = mapping.tty;
    event.windowId = mapping.windowId;
  }

  private async handleHookEvent(event: AgentEvent): Promise<void> {
    await this.applyTtyMapping(event);
    this.emitAgentEvent(event);
  }
}
