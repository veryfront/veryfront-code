/**
 * Veryfront Token Storage Adapter
 *
 * Stores encrypted OAuth tokens in Veryfront Cloud.
 * Tokens are encrypted client-side before being sent to the API.
 */
import { logger } from "../../../../utils/index.js";
import { TokenStorageAPIClient } from "./api-client.js";
import { createTokenConfig, } from "./types.js";
export class VeryfrontTokenAdapter {
    client;
    initialized = false;
    constructor(config) {
        const tokenConfig = createTokenConfig(config);
        this.client = new TokenStorageAPIClient(tokenConfig);
        logger.debug("[VeryfrontTokenAdapter] Created", {
            apiBaseUrl: tokenConfig.apiBaseUrl,
            projectSlug: tokenConfig.projectSlug,
        });
    }
    async initialize() {
        if (this.initialized)
            return;
        logger.debug("[VeryfrontTokenAdapter] Initializing...");
        const connected = await this.client.ping();
        if (!connected)
            throw new Error("Failed to connect to Veryfront token storage API");
        this.initialized = true;
        logger.debug("[VeryfrontTokenAdapter] Initialized successfully");
    }
    async get(key) {
        await this.ensureInitialized();
        logger.debug("[VeryfrontTokenAdapter] Get", { key });
        return this.client.get(key);
    }
    async set(key, value) {
        await this.ensureInitialized();
        logger.debug("[VeryfrontTokenAdapter] Set", { key, valueLength: value.length });
        await this.client.set(key, value);
    }
    async delete(key) {
        await this.ensureInitialized();
        logger.debug("[VeryfrontTokenAdapter] Delete", { key });
        await this.client.delete(key);
    }
    async list(prefix) {
        await this.ensureInitialized();
        logger.debug("[VeryfrontTokenAdapter] List", { prefix });
        return this.client.list(prefix);
    }
    dispose() {
        this.initialized = false;
        logger.debug("[VeryfrontTokenAdapter] Disposed");
    }
    async ensureInitialized() {
        if (this.initialized)
            return;
        await this.initialize();
    }
}
