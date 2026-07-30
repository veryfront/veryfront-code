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
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  type DistributedEventPublisherOptions,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";

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

/** Create an event publisher from an already-activated distributed provider. */
export function createDistributedEventPublisher(
  options: DistributedEventPublisherOptions,
): ClaudeCodeEventPublisher & ClaudeCodeEventSubscriber {
  const publisher = captureDistributedRuntimeProvider(
    resolveExtensionContract<DistributedRuntimeProvider>(
      DistributedRuntimeProviderName,
    ),
  ).createEventPublisher(options);
  if (!publisher || typeof publisher !== "object" || Array.isArray(publisher)) {
    throw new TypeError(
      `${DistributedRuntimeProviderName} returned an invalid event publisher`,
    );
  }
  return publisher;
}

export type { DistributedEventPublisherOptions };

/**
 * Create an event publisher based on environment
 */
export function createEventPublisher(
  options: {
    type: "memory" | "distributed" | "sse" | "callback";
    callback?: ClaudeCodeEventHandler;
  },
): ClaudeCodeEventPublisher {
  switch (options.type) {
    case "memory":
      return new MemoryEventPublisher();

    case "distributed":
      return createDistributedEventPublisher({});

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
