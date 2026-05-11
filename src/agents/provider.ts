import type { AgentAnimationConfig, AgentEvent, AgentType } from "./types.ts";

import { EventEmitter } from "../util/event-emitter.ts";

export abstract class AgentProvider extends EventEmitter {
  abstract readonly animations: AgentAnimationConfig;
  abstract readonly providerType: string;
  abstract readonly supportedAgents: AgentType[];

  /**
   * Close any pending permission connection for the given session.
   * Default is a no-op; providers that hold open hook sockets for
   * blocking permission decisions (e.g. Claude, OpenCode) override this
   * to hang up the socket so a hook script that's now waiting for a
   * dead agent can exit cleanly.
   */
  cancelPendingPermissionsForSession(_sessionId: string): void {}
  abstract start(): Promise<void> | void;
  abstract stop(): void;

  protected emitAgentEvent(event: AgentEvent): void {
    this.emit("agent-event", event);
  }
}

export class AgentProviderRegistry extends EventEmitter {
  private handlers = new Map<AgentProvider, (event: AgentEvent) => void>();
  private providers = new Set<AgentProvider>();

  cancelPendingPermissionsForSession(sessionId: string): void {
    for (const p of this.providers) p.cancelPendingPermissionsForSession(sessionId);
  }

  forwardEvent(event: AgentEvent): void {
    this.emit("agent-event", event);
  }

  getAnimations(agentType: AgentType): AgentAnimationConfig | undefined {
    for (const p of this.providers) {
      if (p.supportedAgents.includes(agentType)) return p.animations;
    }
    return undefined;
  }

  getProvider(providerType: string): AgentProvider | undefined {
    for (const p of this.providers) {
      if (p.providerType === providerType) return p;
    }
    return undefined;
  }

  register(provider: AgentProvider): void {
    this.providers.add(provider);
    const handler = (event: AgentEvent) => this.emit("agent-event", event);
    this.handlers.set(provider, handler);
    provider.on("agent-event", handler);
  }

  startAll(): void {
    for (const p of this.providers) p.start();
  }

  stopAll(): void {
    for (const p of this.providers) p.stop();
  }
}
