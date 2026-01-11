/**
 * Event Publisher Implementations
 *
 * Provides different ways to publish Claude Code events for streaming.
 */

import type {
  ClaudeCodeEvent,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
} from "./types.ts";

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
 * Redis event publisher configuration
 */
export interface RedisEventPublisherConfig {
  /** Redis URL */
  url: string;

  /** Channel prefix (default: "claude-code") */
  channelPrefix?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Redis-based event publisher for distributed streaming
 * Uses Redis Pub/Sub for real-time event delivery
 */
export class RedisEventPublisher implements ClaudeCodeEventPublisher, ClaudeCodeEventSubscriber {
  private config: Required<RedisEventPublisherConfig>;
  private publishClient: any;
  private subscribeClient: any;
  private initialized = false;

  constructor(config: RedisEventPublisherConfig) {
    this.config = {
      channelPrefix: "claude-code",
      debug: false,
      ...config,
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import to avoid loading Redis if not used
    const { createClient } = await import("npm:redis@4.6.13");

    this.publishClient = createClient({ url: this.config.url });
    this.subscribeClient = createClient({ url: this.config.url });

    await Promise.all([this.publishClient.connect(), this.subscribeClient.connect()]);

    this.initialized = true;
  }

  private getChannel(runId: string): string {
    return `${this.config.channelPrefix}:events:${runId}`;
  }

  async publish(event: ClaudeCodeEvent): Promise<void> {
    await this.ensureInitialized();

    const channel = event.runId
      ? this.getChannel(event.runId)
      : `${this.config.channelPrefix}:events:global`;

    const message = JSON.stringify(event);

    await this.publishClient.publish(channel, message);

    if (this.config.debug) {
      console.log(`[RedisEventPublisher] Published to ${channel}:`, event.type);
    }
  }

  async subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
    await this.ensureInitialized();

    const channel = this.getChannel(runId);

    const listener = (message: string) => {
      try {
        const event = JSON.parse(message) as ClaudeCodeEvent;
        handler(event);
      } catch (error) {
        console.error("[RedisEventPublisher] Failed to parse event:", error);
      }
    };

    await this.subscribeClient.subscribe(channel, listener);

    if (this.config.debug) {
      console.log(`[RedisEventPublisher] Subscribed to ${channel}`);
    }

    return async () => {
      await this.subscribeClient.unsubscribe(channel);
    };
  }

  async close(): Promise<void> {
    if (!this.initialized) return;

    await Promise.all([
      this.publishClient?.quit(),
      this.subscribeClient?.quit(),
    ]);

    this.initialized = false;
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
        throw new Error("Redis URL required for redis publisher");
      }
      return new RedisEventPublisher({ url: options.redisUrl });

    case "callback":
      if (!options.callback) {
        throw new Error("Callback required for callback publisher");
      }
      return new CallbackEventPublisher(options.callback);

    case "sse":
      return new SSEEventPublisher();

    default:
      throw new Error(`Unknown publisher type: ${options.type}`);
  }
}
