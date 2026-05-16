import { randomBytes } from "node:crypto";

import type { HookEventValidatorContext } from "../agents/socket-server.ts";
import type { AgentEvent, AgentType } from "../agents/types.ts";

import { HookSocketServer } from "../agents/socket-server.ts";

const HOLD_OPEN_REMOTE_AGENT_TYPES = new Set<AgentType>(["claude", "opencode"]);
const REMOTE_HOOK_LOOPBACK_HOST = "127.0.0.1";

export interface RemoteAgentIngress {
  /** Shared secret embedded in the tmux user-option; remote hook events must include it. */
  readonly authToken: string;
  close(): void;
  /** Loopback TCP port where the local agent ingress is bound; meaningful only after start(). */
  readonly localTcpPort: number;
  respondToPermission(route: RemotePermissionRoute, decision: "allow" | "deny"): boolean;
  start(): void;
}

export interface RemoteAgentIngressFactory {
  create(
    serverName: string,
    handlers: RemoteAgentIngressHandlers,
    options?: RemoteAgentIngressOptions,
  ): RemoteAgentIngress;
}

export interface RemoteAgentIngressHandlers {
  onEvent(event: AgentEvent): void;
}

export interface RemoteAgentIngressOptions {
  eventValidator?: (event: AgentEvent, ctx: HookEventValidatorContext) => Promise<boolean> | boolean;
}

export interface RemotePermissionRoute {
  agentType: AgentType;
  key: string;
}

class ForwardedRemoteAgentIngress implements RemoteAgentIngress {
  readonly authToken: string;

  get localTcpPort(): number {
    return this.socketServer.listenPort ?? 0;
  }

  private socketServer: HookSocketServer;

  constructor(
    _serverName: string,
    private handlers: RemoteAgentIngressHandlers,
    options: RemoteAgentIngressOptions = {},
  ) {
    this.authToken = randomBytes(24).toString("hex");
    this.socketServer = new HookSocketServer({ hostname: REMOTE_HOOK_LOOPBACK_HOST, port: 0, type: "tcp" }, true, {
      authToken: this.authToken,
      eventValidator: options.eventValidator ?? (() => true),
      persistEvents: false,
      shouldHoldPermissionConnection: shouldHoldRemotePermissionConnection,
    });
  }

  close(): void {
    this.socketServer.off("event", this.handleEvent);
    this.socketServer.stop();
  }

  respondToPermission(route: RemotePermissionRoute, decision: "allow" | "deny"): boolean {
    return this.socketServer.respondToPermission(route.key, decision);
  }

  start(): void {
    this.socketServer.on("event", this.handleEvent);
    this.socketServer.start();
  }

  private readonly handleEvent = (event: AgentEvent) => {
    this.handlers.onEvent(event);
  };
}

export class ForwardedRemoteAgentIngressFactory implements RemoteAgentIngressFactory {
  create(
    serverName: string,
    handlers: RemoteAgentIngressHandlers,
    options?: RemoteAgentIngressOptions,
  ): RemoteAgentIngress {
    return new ForwardedRemoteAgentIngress(serverName, handlers, options);
  }
}

function shouldHoldRemotePermissionConnection(event: AgentEvent): boolean {
  return HOLD_OPEN_REMOTE_AGENT_TYPES.has(event.agentType);
}
