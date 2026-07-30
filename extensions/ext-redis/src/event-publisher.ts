/** Redis Pub/Sub implementation of the distributed event publisher contract. */

import { createClient } from "redis";
import { logger as baseLogger } from "veryfront/utils";
import type {
  ClaudeCodeEvent,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
} from "veryfront/workflow/claude-code";

const logger = baseLogger.component("redis-event-publisher");

export interface RedisEventPublisherConfig {
  url: string;
  channelPrefix?: string;
  debug?: boolean;
}

interface RedisClient {
  connect(): Promise<void>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  close(): Promise<void>;
}

export class RedisEventPublisher implements ClaudeCodeEventPublisher, ClaudeCodeEventSubscriber {
  private readonly config: Required<RedisEventPublisherConfig>;
  private publishClient: RedisClient | null = null;
  private subscribeClient: RedisClient | null = null;
  private initialization: Promise<void> | null = null;

  constructor(config: RedisEventPublisherConfig) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new TypeError("Redis event publisher config must be an object");
    }
    if (typeof config.url !== "string" || config.url.length === 0) {
      throw new TypeError("Redis event publisher requires a connection URL");
    }
    this.config = {
      channelPrefix: "claude-code",
      debug: false,
      ...config,
    };
  }

  private ensureInitialized(): Promise<void> {
    if (this.publishClient && this.subscribeClient) return Promise.resolve();
    if (this.initialization) return this.initialization;
    const initialization = (async () => {
      const publishClient = createClient({ url: this.config.url }) as unknown as RedisClient;
      const subscribeClient = createClient({ url: this.config.url }) as unknown as RedisClient;
      try {
        await Promise.all([publishClient.connect(), subscribeClient.connect()]);
      } catch (error) {
        await Promise.allSettled([publishClient.close(), subscribeClient.close()]);
        throw error;
      }
      this.publishClient = publishClient;
      this.subscribeClient = subscribeClient;
    })().finally(() => {
      if (this.initialization === initialization) this.initialization = null;
    });
    this.initialization = initialization;
    return initialization;
  }

  private getChannel(runId: string): string {
    return `${this.config.channelPrefix}:events:${runId}`;
  }

  async publish(event: ClaudeCodeEvent): Promise<void> {
    await this.ensureInitialized();
    const client = this.publishClient;
    if (!client) throw new Error("Redis publish client not initialized");
    const channel = event.runId
      ? this.getChannel(event.runId)
      : `${this.config.channelPrefix}:events:global`;
    await client.publish(channel, JSON.stringify(event));
    if (this.config.debug) logger.info("Published event", { channel, eventType: event.type });
  }

  async subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void> {
    await this.ensureInitialized();
    const client = this.subscribeClient;
    if (!client) throw new Error("Redis subscribe client not initialized");
    const channel = this.getChannel(runId);
    const listener = (message: string) => {
      try {
        const parsed: unknown = JSON.parse(message);
        if (parsed && typeof parsed === "object") handler(parsed as ClaudeCodeEvent);
      } catch (error) {
        logger.error("Failed to parse event", error);
      }
    };
    await client.subscribe(channel, listener);
    if (this.config.debug) logger.info("Subscribed to channel", { channel });
    return () => client.unsubscribe(channel);
  }

  async close(): Promise<void> {
    const initialization = this.initialization;
    if (initialization) await initialization.catch(() => undefined);
    const clients = [this.publishClient, this.subscribeClient].filter(
      (client): client is RedisClient => client !== null,
    );
    this.publishClient = null;
    this.subscribeClient = null;
    const results = await Promise.allSettled(clients.map((client) => client.close()));
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Redis event publisher close failed");
    }
  }
}
