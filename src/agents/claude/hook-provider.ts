import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { AgentAnimationConfig, AgentEvent, AgentType } from "../types.ts";

import { AgentProvider } from "../provider.ts";
import { HookSocketServer, loadPersistedSessions } from "../socket-server.ts";
import { TmuxTtyResolver } from "../tmux-tty-resolver.ts";
import { CLAUDE_ANIMATIONS } from "../types.ts";

export class ClaudeHookProvider extends AgentProvider {
  readonly animations: AgentAnimationConfig = CLAUDE_ANIMATIONS;
  readonly providerType = "claude-hook";
  readonly supportedAgents: AgentType[] = ["claude"];

  private socketServer: HookSocketServer;
  private ttyResolver: TmuxTtyResolver;

  constructor(client: TmuxControlClient) {
    super();
    this.socketServer = new HookSocketServer();
    this.ttyResolver = new TmuxTtyResolver(client);
  }

  respondToPermission(sessionId: string, toolUseId: string, decision: "allow" | "deny"): void {
    const key = toolUseId || sessionId;
    this.socketServer.respondToPermission(key, decision);
  }

  start(): void {
    this.ttyResolver.start();
    this.socketServer.start();
    this.socketServer.on("event", (event: AgentEvent) => this.handleEvent(event));

    // Rediscover sessions that were running before honeymux restarted
    for (const event of loadPersistedSessions("claude")) {
      this.handleEvent(event);
    }
  }

  stop(): void {
    this.ttyResolver.stop();
    this.socketServer.stop();
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    if (!event.isRemote) {
      const mapping = event.paneId
        ? await this.resolvePaneId(event.paneId)
        : event.tty
          ? await this.resolveTty(event.tty)
          : undefined;
      if (mapping) {
        event.paneId = mapping.paneId;
        event.sessionName = mapping.sessionName;
        event.tty = mapping.tty;
        event.windowId = mapping.windowId;
      }
    }

    this.emitAgentEvent(event);
  }

  private async resolvePaneId(paneId: string) {
    return this.ttyResolver.resolvePaneId(paneId);
  }

  private async resolveTty(tty: string) {
    return this.ttyResolver.resolveTty(tty);
  }
}
