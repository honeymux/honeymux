import type { TmuxControlClient } from "../../tmux/control-client.ts";
import type { AgentAnimationConfig, AgentEvent, AgentType } from "../types.ts";

import { AgentProvider } from "../provider.ts";
import { HookSocketServer, getOpenCodeSocketPath, loadPersistedSessions } from "../socket-server.ts";
import { TmuxTtyResolver } from "../tmux-tty-resolver.ts";
import { OPENCODE_ANIMATIONS } from "../types.ts";

export class OpenCodePluginProvider extends AgentProvider {
  readonly animations: AgentAnimationConfig = OPENCODE_ANIMATIONS;
  readonly providerType = "opencode-plugin";
  readonly supportedAgents: AgentType[] = ["opencode"];

  private socketServer: HookSocketServer;
  private ttyResolver: TmuxTtyResolver;

  constructor(client: TmuxControlClient) {
    super();
    // holdPermissionConnections=true: the plugin keeps the socket open for
    // permission events so we can send back allow/deny decisions. The plugin
    // then forwards the decision to OpenCode via the in-process SDK client.
    this.socketServer = new HookSocketServer(getOpenCodeSocketPath(), true);
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
    for (const event of loadPersistedSessions("opencode")) {
      this.handleEvent(event);
    }
  }

  stop(): void {
    this.ttyResolver.stop();
    this.socketServer.stop();
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    if (event.tty && !event.isRemote) {
      const mapping = await this.resolveTty(event.tty);
      if (mapping) {
        event.paneId = mapping.paneId;
        event.sessionName = mapping.sessionName;
        event.windowId = mapping.windowId;
      }
    }

    this.emitAgentEvent(event);
  }

  private async resolveTty(tty: string) {
    return this.ttyResolver.resolveTty(tty);
  }
}
