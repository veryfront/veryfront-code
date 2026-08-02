/**
 * Event Publisher Implementations
 *
 * Provides different ways to publish Claude Code events for streaming.
 */

import { ensureRedisRuntimeProvider } from "#veryfront/extensions/distributed/defaults.ts";
import type {
  RedisEventPublisherConfig,
  RedisEventPublisherImplementation,
} from "#veryfront/extensions/distributed/redis-runtime-provider.ts";
import type {
  ClaudeCodeEvent,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
} from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

export type { RedisEventPublisherConfig };

// =============================================================================
// In-Memory Publisher (for testing/single-process)
// =============================================================================

/**
 * In-memory event publisher using EventTarget
 * Useful for testing or single-process deployments
 */
export class MemoryEventPublisher implements ClaudeCodeEventPublisher, ClaudeCodeEventSubscriber {
  private handlers = new Map<string, Set<ClaudeCodeEventHandler>>();
  private globalHandlers = new Set<ClaudeCodeEventHandler>();

  publish(event: ClaudeCodeEvent): void {
    // Notify run-specific handlers
    if (event.runId) {
      const handlers = this.handlers.get(event.runId);
      if (handlers) {
        for (const handler of handlers) {
          handler(event);
        }
      }
    }

    // Notify global handlers
    for (const handler of this.globalHandlers) {
      handler(event);
    }
  }

  subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
    if (!this.handlers.has(runId)) {
      this.handlers.set(runId, new Set());
    }
    this.handlers.get(runId)!.add(handler);

    return Promise.resolve(() => {
      this.handlers.get(runId)?.delete(handler);
    });
  }

  subscribeAll(handler: ClaudeCodeEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  close(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}

// =============================================================================
// Redis Publisher (for distributed deployments)
// =============================================================================

/**
 * Redis-based event publisher for distributed streaming
 * Uses Redis Pub/Sub for real-time event delivery
 */
/** Implement redis event publisher. */
export class RedisEventPublisher implements ClaudeCodeEventPublisher, ClaudeCodeEventSubscriber {
  private readonly config: RedisEventPublisherConfig;
  private implementation: RedisEventPublisherImplementation | null = null;
  private initialization: Promise<RedisEventPublisherImplementation> | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(config: RedisEventPublisherConfig) {
    this.config = Object.freeze({ ...config });
  }

  private async getImplementation(): Promise<RedisEventPublisherImplementation> {
    if (this.closePromise) await this.closePromise;
    if (this.implementation) return this.implementation;
    if (this.initialization) return this.initialization;

    const initialization = ensureRedisRuntimeProvider()
      .then((provider) => provider.createEventPublisher(this.config))
      .then((implementation) => {
        this.implementation = implementation;
        return implementation;
      })
      .finally(() => {
        if (this.initialization === initialization) this.initialization = null;
      });
    this.initialization = initialization;
    return initialization;
  }

  async publish(event: ClaudeCodeEvent): Promise<void> {
    const implementation = await this.getImplementation();
    await implementation.publish(event);
  }

  async subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
    const implementation = await this.getImplementation();
    return await implementation.subscribe(runId, handler);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const initialization = this.initialization;
    const closing = (async () => {
      let implementation = this.implementation;
      if (!implementation && initialization) {
        try {
          implementation = await initialization;
        } catch {
          return;
        }
      }
      if (!implementation) return;
      await implementation.close();
      if (this.implementation === implementation) this.implementation = null;
    })().finally(() => {
      if (this.closePromise === closing) this.closePromise = null;
    });
    this.closePromise = closing;
    return closing;
  }
}

// =============================================================================
// SSE Publisher (for HTTP streaming)
// =============================================================================

/**
 * Server-Sent Events publisher
 * Writes events directly to a ReadableStream controller
 */
export class SSEEventPublisher implements ClaudeCodeEventPublisher {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private closed = false;

  /**
   * Create an SSE publisher with an associated ReadableStream
   */
  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
        this.controller = null;
      },
    });
  }

  publish(event: ClaudeCodeEvent): void {
    if (this.closed || !this.controller) return;

    const data = `data: ${JSON.stringify(event)}\n\n`;
    this.controller.enqueue(this.encoder.encode(data));
  }

  close(): void {
    if (this.closed || !this.controller) return;

    this.closed = true;
    this.controller.close();
    this.controller = null;
  }
}

// =============================================================================
// Callback Publisher (for simple use cases)
// =============================================================================

/**
 * Simple callback-based publisher
 * Calls a function for each event
 */
export class CallbackEventPublisher implements ClaudeCodeEventPublisher {
  constructor(private callback: ClaudeCodeEventHandler) {}

  publish(event: ClaudeCodeEvent): void {
    this.callback(event);
  }

  close(): void {
    // No cleanup needed
  }
}

// =============================================================================
// Multi Publisher (broadcast to multiple publishers)
// =============================================================================

/**
 * Publishes events to multiple publishers
 */
export class MultiEventPublisher implements ClaudeCodeEventPublisher {
  private publishers: ClaudeCodeEventPublisher[];

  constructor(...publishers: ClaudeCodeEventPublisher[]) {
    this.publishers = publishers;
  }

  async publish(event: ClaudeCodeEvent): Promise<void> {
    await Promise.all(this.publishers.map((p) => p.publish(event)));
  }

  async close(): Promise<void> {
    await Promise.all(this.publishers.map((p) => p.close()));
  }

  addPublisher(publisher: ClaudeCodeEventPublisher): void {
    this.publishers.push(publisher);
  }

  removePublisher(publisher: ClaudeCodeEventPublisher): void {
    const index = this.publishers.indexOf(publisher);
    if (index !== -1) {
      this.publishers.splice(index, 1);
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an event publisher based on environment
 */
export function createEventPublisher(
  options: {
    type: "memory" | "redis" | "sse" | "callback";
    redisUrl?: string;
    callback?: ClaudeCodeEventHandler;
  },
): ClaudeCodeEventPublisher {
  switch (options.type) {
    case "memory":
      return new MemoryEventPublisher();

    case "redis":
      if (!options.redisUrl) {
        throw INVALID_ARGUMENT.create({ detail: "Redis URL required for redis publisher" });
      }
      return new RedisEventPublisher({ url: options.redisUrl });

    case "callback":
      if (!options.callback) {
        throw INVALID_ARGUMENT.create({ detail: "Callback required for callback publisher" });
      }
      return new CallbackEventPublisher(options.callback);

    case "sse":
      return new SSEEventPublisher();

    default:
      throw INVALID_ARGUMENT.create({ detail: `Unknown publisher type: ${options.type}` });
  }
}
