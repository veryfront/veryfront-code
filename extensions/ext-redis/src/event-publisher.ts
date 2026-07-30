/** Public Redis Pub/Sub implementation of the distributed event-publisher contract. */

import type {
  ClaudeCodeEvent,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
} from "veryfront/workflow/claude-code";
import {
  createRedisEventPublisherImplementation,
  type RedisEventPublisherConfig,
  type RedisEventPublisherImplementation,
} from "./event-publisher-internal.ts";

export type { RedisEventPublisherConfig } from "./event-publisher-internal.ts";

/**
 * Redis event publisher facade.
 *
 * Third-party client construction and lifecycle mechanics stay package-private
 * so the public constructor remains a stable, configuration-only API.
 */
export class RedisEventPublisher implements ClaudeCodeEventPublisher, ClaudeCodeEventSubscriber {
  private readonly implementation: RedisEventPublisherImplementation;

  constructor(config: RedisEventPublisherConfig) {
    this.implementation = createRedisEventPublisherImplementation(config);
  }

  publish(event: ClaudeCodeEvent): Promise<void> {
    return this.implementation.publish(event);
  }

  subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
    return this.implementation.subscribe(runId, handler);
  }

  close(): Promise<void> {
    return this.implementation.close();
  }
}
