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
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { resolve as resolveExtensionContract } from "#veryfront/extensions/contracts.ts";
import {
  captureDistributedRuntimeProvider,
  type DistributedEventPublisherOptions,
  type DistributedRuntimeProvider,
  DistributedRuntimeProviderName,
} from "#veryfront/extensions/distributed/index.ts";

function dispatchDeliveries<T>(
  groups: Iterable<Iterable<T>>,
  dispatch: (value: T) => void | Promise<void>,
): void | Promise<void> {
  const pending: Promise<void>[] = [];
  try {
    for (const group of groups) {
      for (const value of group) {
        const delivery = dispatch(value);
        if (delivery !== undefined) pending.push(delivery);
      }
    }
  } catch (error) {
    if (pending.length === 0) throw error;
    // Once asynchronous delivery has started, aggregate a later synchronous
    // failure so every admitted promise remains observed by the caller.
    pending.push(Promise.reject(error));
  }

  if (pending.length === 1) return pending[0];
  if (pending.length > 1) return Promise.all(pending).then(() => undefined);
}

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

  publish(event: ClaudeCodeEvent): void | Promise<void> {
    const runHandlers = event.runId === undefined ? undefined : this.handlers.get(event.runId);
    return dispatchDeliveries(
      runHandlers === undefined ? [this.globalHandlers] : [runHandlers, this.globalHandlers],
      (handler) => handler(event),
    );
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
  private state: "idle" | "open" | "closed" = "idle";

  /**
   * Create an SSE publisher with an associated ReadableStream
   */
  createStream(): ReadableStream<Uint8Array> {
    if (this.state === "closed") {
      throw ORCHESTRATION_ERROR.create({ detail: "SSE event publisher is closed" });
    }
    if (this.state === "open") {
      throw ORCHESTRATION_ERROR.create({
        detail: "SSE event publisher already has a stream",
      });
    }

    this.state = "open";
    try {
      return new ReadableStream({
        start: (controller) => {
          this.controller = controller;
        },
        cancel: () => {
          this.state = "closed";
          this.controller = null;
        },
      });
    } catch (error) {
      this.state = "closed";
      this.controller = null;
      throw error;
    }
  }

  publish(event: ClaudeCodeEvent): void {
    if (this.state === "closed") {
      throw ORCHESTRATION_ERROR.create({ detail: "SSE event publisher is closed" });
    }
    if (this.state === "idle") {
      throw ORCHESTRATION_ERROR.create({
        detail: "SSE event publisher does not have a stream",
      });
    }
    const controller = this.controller;
    if (controller === null) {
      throw ORCHESTRATION_ERROR.create({
        detail: "SSE event publisher has no active stream controller",
      });
    }

    const data = `data: ${JSON.stringify(event)}\n\n`;
    controller.enqueue(this.encoder.encode(data));
  }

  close(): void {
    if (this.state === "closed") return;
    if (this.state === "idle") {
      this.state = "closed";
      return;
    }

    const controller = this.controller;
    this.state = "closed";
    this.controller = null;
    if (controller === null) {
      throw ORCHESTRATION_ERROR.create({
        detail: "SSE event publisher has no active stream controller",
      });
    }
    controller.close();
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

  publish(event: ClaudeCodeEvent): void | Promise<void> {
    return this.callback(event);
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
    await dispatchDeliveries<ClaudeCodeEventPublisher>(
      [this.publishers],
      (publisher) => publisher.publish(event),
    );
  }

  async close(): Promise<void> {
    await dispatchDeliveries<ClaudeCodeEventPublisher>(
      [this.publishers],
      (publisher) => publisher.close(),
    );
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
