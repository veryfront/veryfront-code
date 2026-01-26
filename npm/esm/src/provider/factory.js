import * as dntShim from "../../_dnt.shims.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { agentLogger } from "../utils/logger/logger.js";
import { createError, toError } from "../errors/veryfront-error.js";
import { getAnthropicEnvConfig, getGoogleGenAIEnvConfig, getOpenAIEnvConfig, } from "../config/env.js";
class ProviderRegistry {
    providers = new Map();
    config = {};
    autoInitialized = false;
    registerProvider(name, createProvider, fromEnv = false) {
        try {
            this.providers.set(name, createProvider());
            if (fromEnv) {
                agentLogger.debug(`Auto-initialized ${name} provider from environment`);
            }
        }
        catch (error) {
            const source = fromEnv ? "auto-initialize" : "initialize";
            agentLogger.warn(`Failed to ${source} ${name} provider:`, error);
        }
    }
    autoInitializeFromEnv() {
        if (this.autoInitialized)
            return;
        this.autoInitialized = true;
        const openaiEnv = getOpenAIEnvConfig();
        const openaiApiKey = openaiEnv.apiKey;
        if (openaiApiKey && !this.providers.has("openai")) {
            this.registerProvider("openai", () => new OpenAIProvider({
                apiKey: openaiApiKey,
                baseURL: openaiEnv.baseURL,
                organizationId: openaiEnv.organizationId,
            }), true);
        }
        const anthropicEnv = getAnthropicEnvConfig();
        const anthropicApiKey = anthropicEnv.apiKey;
        if (anthropicApiKey && !this.providers.has("anthropic")) {
            this.registerProvider("anthropic", () => new AnthropicProvider({
                apiKey: anthropicApiKey,
                baseURL: anthropicEnv.baseURL,
            }), true);
        }
        const googleEnv = getGoogleGenAIEnvConfig();
        const googleApiKey = googleEnv.apiKey;
        if (googleApiKey && !this.providers.has("google")) {
            this.registerProvider("google", () => new GoogleProvider({ apiKey: googleApiKey }), true);
        }
    }
    initialize(config) {
        this.config = config;
        const openaiConfig = config.openai;
        if (openaiConfig) {
            this.registerProvider("openai", () => new OpenAIProvider(openaiConfig));
        }
        const anthropicConfig = config.anthropic;
        if (anthropicConfig) {
            this.registerProvider("anthropic", () => new AnthropicProvider(anthropicConfig));
        }
        const googleConfig = config.google;
        if (googleConfig) {
            this.registerProvider("google", () => new GoogleProvider(googleConfig));
        }
    }
    getProvider(name) {
        this.autoInitializeFromEnv();
        const provider = this.providers.get(name);
        if (provider)
            return provider;
        throw toError(createError({
            type: "agent",
            message: `Provider "${name}" not found. Available providers: ${Array.from(this.providers.keys()).join(", ")}`,
        }));
    }
    getProviderFromModel(modelString) {
        const parts = modelString.split("/");
        if (parts.length !== 2) {
            throw toError(createError({
                type: "config",
                message: `Invalid model string format: "${modelString}". Expected format: "provider/model-name" (e.g., "openai/gpt-4")`,
            }));
        }
        const [providerName, modelName] = parts;
        if (!providerName || !modelName) {
            throw toError(createError({
                type: "config",
                message: `Invalid model string format: "${modelString}". Both provider and model name are required.`,
            }));
        }
        return { provider: this.getProvider(providerName), model: modelName };
    }
    getDefaultProvider() {
        return this.getProvider(this.config.default ?? "openai");
    }
    hasProvider(name) {
        this.autoInitializeFromEnv();
        return this.providers.has(name);
    }
    getAvailableProviders() {
        this.autoInitializeFromEnv();
        return Array.from(this.providers.keys());
    }
    clear() {
        this.providers.clear();
        this.config = {};
    }
}
const PROVIDER_REGISTRY_KEY = "__veryfront_provider_registry__";
// deno-lint-ignore no-explicit-any
const _globalProvider = dntShim.dntGlobalThis;
export const providerRegistry = _globalProvider[PROVIDER_REGISTRY_KEY] ||=
    new ProviderRegistry();
export function initializeProviders(config) {
    providerRegistry.initialize(config);
}
export function getProvider(name) {
    return providerRegistry.getProvider(name);
}
export function getProviderFromModel(modelString) {
    return providerRegistry.getProviderFromModel(modelString);
}
