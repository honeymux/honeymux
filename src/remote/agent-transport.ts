import { createHash } from "node:crypto";

import type { AgentEvent, AgentType } from "../agents/types.ts";

import { HookSocketServer } from "../agents/socket-server.ts";
import { getPrivateSocketPath } from "../util/runtime-paths.ts";
import { getTmuxServer } from "../util/tmux-server.ts";

const HOLD_OPEN_REMOTE_AGENT_TYPES = new Set<AgentType>(["claude", "opencode"]);

export interface RemoteAgentIngress {
  close(): void;
  readonly localSocketPath: string;
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
  eventValidator?: (event: AgentEvent) => Promise<boolean> | boolean;
}

export interface RemotePermissionRoute {
  agentType: AgentType;
  key: string;
}

export class ForwardedRemoteAgentIngress implements RemoteAgentIngress {
  readonly localSocketPath: string;

  private socketServer: HookSocketServer;

  constructor(
    serverName: string,
    private handlers: RemoteAgentIngressHandlers,
    options: RemoteAgentIngressOptions = {},
  ) {
    this.localSocketPath = getRemoteAgentIngressSocketPath(serverName);
    this.socketServer = new HookSocketServer(this.localSocketPath, true, {
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

export function getRemoteAgentIngressSocketPath(serverName: string): string {
  const tmuxServer = getTmuxServer();
  const digest = createHash("sha256").update(`${tmuxServer}\0${serverName}`).digest("hex").slice(0, 16);
  return getPrivateSocketPath(`hmx-remote-hook-${digest}`);
}

function shouldHoldRemotePermissionConnection(event: AgentEvent): boolean {
  return HOLD_OPEN_REMOTE_AGENT_TYPES.has(event.agentType);
}
