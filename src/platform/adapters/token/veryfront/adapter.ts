/**
 * Veryfront Token Storage Adapter
 *
 * Stores encrypted OAuth tokens in Veryfront Cloud.
 * Tokens are encrypted client-side before being sent to the API.
 */

import { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { TokenStorageApiClient, type TokenStorageApiClientDependencies } from "./api-client.ts";
import {
  createTokenConfig,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
  type TokenStorageRequestOptions,
} from "./types.ts";

const logger = baseLogger.component("veryfront-token-adapter");

interface PendingInitialization {
  generation: number;
  promise: Promise<void>;
}

export class VeryfrontTokenAdapter implements TokenStorageAdapter {
  private readonly client: TokenStorageApiClient;
  private initialized = false;
  private generation = 0;
  private lifecycleController = new AbortController();
  private pendingInitialization: PendingInitialization | null = null;

  constructor(
    config: TokenStorageAdapterConfig,
    dependencies: TokenStorageApiClientDependencies = {},
  ) {
    this.client = new TokenStorageApiClient(createTokenConfig(config), dependencies);
    logger.debug("Created token storage adapter");
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();

    const generation = this.generation;
    if (this.pendingInitialization?.generation === generation) {
      return this.pendingInitialization.promise;
    }

    const pending = this.initializeGeneration(generation, this.lifecycleController.signal);
    const tracked = pending.finally(() => {
      if (
        this.pendingInitialization?.generation === generation &&
        this.pendingInitialization.promise === tracked
      ) {
        this.pendingInitialization = null;
      }
    });
    this.pendingInitialization = { generation, promise: tracked };
    return tracked;
  }

  async get(
    key: string,
    options: TokenStorageRequestOptions = {},
  ): Promise<string | null> {
    await this.waitForInitialization(options.signal);
    logger.debug("Getting token");
    return await this.client.get(key, options);
  }

  async set(
    key: string,
    value: string,
    options: TokenStorageRequestOptions = {},
  ): Promise<void> {
    await this.waitForInitialization(options.signal);
    logger.debug("Setting token");
    await this.client.set(key, value, options);
  }

  async delete(key: string, options: TokenStorageRequestOptions = {}): Promise<void> {
    await this.waitForInitialization(options.signal);
    logger.debug("Deleting token");
    await this.client.delete(key, options);
  }

  async list(
    prefix?: string,
    options: TokenStorageRequestOptions = {},
  ): Promise<string[]> {
    await this.waitForInitialization(options.signal);
    logger.debug("Listing tokens");
    return await this.client.list(prefix, options);
  }

  dispose(): void {
    this.generation++;
    this.initialized = false;
    this.pendingInitialization = null;
    this.lifecycleController.abort();
    this.lifecycleController = new AbortController();
    logger.debug("Disposed token storage adapter");
  }

  private async initializeGeneration(generation: number, signal: AbortSignal): Promise<void> {
    logger.debug("Initializing token storage adapter");
    const connected = await this.client.ping({ signal });

    if (generation !== this.generation) throw this.cancelledError();
    if (!connected) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: "Veryfront token storage API is unavailable",
        status: 502,
      });
    }

    this.initialized = true;
    logger.debug("Initialized token storage adapter");
  }

  private async waitForInitialization(signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await this.initialize();
      return;
    }
    if (signal.aborted) throw this.cancelledError();

    let cancelWait: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancelWait = () => reject(this.cancelledError());
      signal.addEventListener("abort", cancelWait, { once: true });
    });

    try {
      await Promise.race([this.initialize(), cancelled]);
    } finally {
      if (cancelWait) signal.removeEventListener("abort", cancelWait);
    }
  }

  private cancelledError() {
    return TOKEN_STORAGE_ERROR.create({
      detail: "Token storage initialization was cancelled",
      status: 499,
    });
  }
}
