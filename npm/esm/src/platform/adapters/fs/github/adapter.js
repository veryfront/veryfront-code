import { logger } from "../../../../utils/index.js";
import { getGithubEnvConfig } from "../../../../config/env.js";
import { FileCache } from "../cache/file-cache.js";
import { GitHubAPIClient } from "./github-api-client.js";
import { GitHubDirectoryOperations } from "./directory-operations.js";
import { GitHubReadOperations } from "./read-operations.js";
import { GitHubStatOperations } from "./stat-operations.js";
import { createGitHubConfig, } from "./types.js";
const LOG_PREFIX = "[GitHubFSAdapter]";
export class GitHubFSAdapter {
    config;
    client;
    cache;
    statOps;
    readOps;
    dirOps;
    projectDir;
    initialized = false;
    constructor(adapterConfig) {
        const githubConfig = adapterConfig.github;
        if (!githubConfig) {
            throw new Error("GitHub adapter requires github configuration");
        }
        this.projectDir = adapterConfig.projectDir || "";
        const envConfig = getGithubEnvConfig();
        const rawConfig = {
            token: githubConfig.token || envConfig.token || "",
            owner: githubConfig.owner || envConfig.owner || "",
            repo: githubConfig.repo || envConfig.repo || "",
            ref: githubConfig.ref || envConfig.ref || "main",
            cache: githubConfig.cache,
            retry: githubConfig.retry,
        };
        this.config = createGitHubConfig(rawConfig);
        this.client = new GitHubAPIClient(this.config);
        this.cache = new FileCache({
            enabled: this.config.cache.enabled,
            ttl: this.config.cache.ttl,
            maxSize: this.config.cache.maxSize,
            maxMemory: this.config.cache.maxMemory,
        });
        this.statOps = new GitHubStatOperations(this.config, this.client, this.cache, this.projectDir);
        this.readOps = new GitHubReadOperations(this.config, this.client, this.cache, this.statOps, this.projectDir);
        this.dirOps = new GitHubDirectoryOperations(this.config, this.cache, this.statOps, this.projectDir);
        logger.debug(`${LOG_PREFIX} Created adapter`, {
            repo: this.client.repoId,
            ref: this.config.ref,
        });
    }
    async initialize() {
        if (this.initialized)
            return;
        logger.debug(`${LOG_PREFIX} Initializing`, {
            repo: this.client.repoId,
            ref: this.config.ref,
        });
        await this.statOps.buildIndex();
        this.initialized = true;
        logger.debug(`${LOG_PREFIX} Initialized successfully`);
    }
    async readFile(path) {
        await this.ensureInitialized();
        return this.readOps.readFile(path);
    }
    async readTextFile(path) {
        await this.ensureInitialized();
        return this.readOps.readTextFile(path);
    }
    async exists(path) {
        await this.ensureInitialized();
        return this.statOps.exists(path);
    }
    async stat(path) {
        await this.ensureInitialized();
        return this.statOps.stat(path);
    }
    async *readDir(path) {
        await this.ensureInitialized();
        yield* this.dirOps.readDir(path);
    }
    async readdir(path) {
        await this.ensureInitialized();
        return this.dirOps.readdir(path);
    }
    async resolveFile(basePath) {
        await this.ensureInitialized();
        return this.statOps.resolveFile(basePath);
    }
    getCacheStats() {
        const { size, memoryUsed, hits, misses, hitRate } = this.cache.stats();
        return { cache: { size, memoryUsed, hits, misses, hitRate } };
    }
    getRateLimitInfo() {
        return this.client.getRateLimitInfo();
    }
    dispose() {
        this.cache.clear();
        this.statOps.clearIndex();
        this.initialized = false;
        logger.debug(`${LOG_PREFIX} Disposed`);
    }
    async ensureInitialized() {
        if (this.initialized)
            return;
        await this.initialize();
    }
}
