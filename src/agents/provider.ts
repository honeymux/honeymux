import type { AgentAnimationConfig, AgentEvent, AgentType } from "./types.ts";

import { EventEmitter } from "../util/event-emitter.ts";

export abstract class AgentProvider extends EventEmitter {
  abstract readonly animations: AgentAnimationConfig;
  abstract readonly providerType: string;
  abstract readonly supportedAgents: AgentType[];
  abstract start(): Promise<void> | void;
  abstract stop(): void;

  protected emitAgentEvent(event: AgentEvent): void {
    this.emit("agent-event", event);
  }
}

export class AgentProviderRegistry extends EventEmitter {
  private handlers = new Map<AgentProvider, (event: AgentEvent) => void>();
  private providers = new Set<AgentProvider>();

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
