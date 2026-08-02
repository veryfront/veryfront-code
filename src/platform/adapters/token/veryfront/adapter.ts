/**
 * Veryfront Token Storage Adapter
 *
 * Stores encrypted OAuth tokens in Veryfront Cloud.
 * Tokens are encrypted client-side before being sent to the API.
 */

import { logger as baseLogger } from "#veryfront/utils";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors";
import { TokenStorageApiClient } from "./api-client.ts";
import {
  createTokenConfig,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
} from "./types.ts";

const logger = baseLogger.component("veryfront-token-adapter");

export class VeryfrontTokenAdapter implements TokenStorageAdapter {
  private client: TokenStorageApiClient;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private initializationController: AbortController | null = null;
  private lifecycleGeneration = 0;

  constructor(config: TokenStorageAdapterConfig) {
    const tokenConfig = createTokenConfig(config);
    this.client = new TokenStorageApiClient(tokenConfig);

    logger.debug("Created", {
      apiBaseUrl: tokenConfig.apiBaseUrl,
      projectSlug: tokenConfig.projectSlug,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return await this.initialization;

    logger.debug("Initializing...");

    const generation = this.lifecycleGeneration;
    const controller = new AbortController();
    const initialization = this.doInitialize(generation, controller.signal);
    this.initializationController = controller;
    this.initialization = initialization;

    try {
      await initialization;
    } finally {
      if (this.initialization === initialization) {
        this.initialization = null;
        this.initializationController = null;
      }
    }
  }

  async get(key: string): Promise<string | null> {
    await this.initialize();
    logger.debug("Get", { key });
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.initialize();
    logger.debug("Set", { key, valueLength: value.length });
    await this.client.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.initialize();
    logger.debug("Delete", { key });
    await this.client.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    await this.initialize();
    logger.debug("List", { prefix });
    return this.client.list(prefix);
  }

  dispose(): void {
    this.lifecycleGeneration++;
    this.initializationController?.abort(
      new DOMException("Token storage initialization was invalidated", "AbortError"),
    );
    this.initializationController = null;
    this.initialization = null;
    this.initialized = false;
    logger.debug("Disposed");
  }

  private async doInitialize(
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const connected = await this.client.ping(signal);
    signal.throwIfAborted();
    if (generation !== this.lifecycleGeneration) {
      throw new DOMException(
        "Token storage initialization was invalidated",
        "AbortError",
      );
    }
    if (!connected) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: "Failed to connect to Veryfront token storage API",
      });
    }

    this.initialized = true;
    logger.debug("Initialized successfully");
  }
}
