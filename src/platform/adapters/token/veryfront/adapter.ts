/**
 * Veryfront Token Storage Adapter
 *
 * Stores encrypted OAuth tokens in Veryfront Cloud.
 * Tokens are encrypted client-side before being sent to the API.
 */

import { logger } from "#veryfront/utils";
import { TokenStorageApiClient } from "./api-client.ts";
import {
  createTokenConfig,
  type TokenStorageAdapter,
  type TokenStorageAdapterConfig,
} from "./types.ts";

const log = logger.component("veryfront-token-adapter");

export class VeryfrontTokenAdapter implements TokenStorageAdapter {
  private client: TokenStorageApiClient;
  private initialized = false;

  constructor(config: TokenStorageAdapterConfig) {
    const tokenConfig = createTokenConfig(config);
    this.client = new TokenStorageApiClient(tokenConfig);

    log.debug("Created", {
      apiBaseUrl: tokenConfig.apiBaseUrl,
      projectSlug: tokenConfig.projectSlug,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.debug("Initializing...");

    const connected = await this.client.ping();
    if (!connected) {
      throw new Error("Failed to connect to Veryfront token storage API");
    }

    this.initialized = true;
    log.debug("Initialized successfully");
  }

  async get(key: string): Promise<string | null> {
    await this.initialize();
    log.debug("Get", { key });
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.initialize();
    log.debug("Set", { key, valueLength: value.length });
    await this.client.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.initialize();
    log.debug("Delete", { key });
    await this.client.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    await this.initialize();
    log.debug("List", { prefix });
    return this.client.list(prefix);
  }

  dispose(): void {
    this.initialized = false;
    log.debug("Disposed");
  }
}
