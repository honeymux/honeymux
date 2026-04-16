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
    this.socketServer = new HookSocketServer(getCodexSocketPath(), false);
    this.ttyResolver = new TmuxTtyResolver(client);
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
    if (!event.tty || event.isRemote) return;

    const mapping = await this.resolveTty(event.tty);
    if (!mapping) return;

    event.paneId = mapping.paneId;
    event.sessionName = mapping.sessionName;
    event.windowId = mapping.windowId;
  }

  private async handleHookEvent(event: AgentEvent): Promise<void> {
    await this.applyTtyMapping(event);
    this.emitAgentEvent(event);
  }

  private async resolveTty(tty: string) {
    return this.ttyResolver.resolveTty(tty);
  }
}
