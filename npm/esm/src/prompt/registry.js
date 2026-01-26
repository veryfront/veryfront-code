import * as dntShim from "../../_dnt.shims.js";
import { agentLogger } from "../utils/logger/logger.js";
import { createError, toError } from "../errors/veryfront-error.js";
class PromptRegistryClass {
    prompts = new Map();
    register(id, promptInstance) {
        if (this.prompts.has(id)) {
            agentLogger.debug(`Prompt "${id}" is already registered. Overwriting.`);
        }
        this.prompts.set(id, promptInstance);
    }
    get(id) {
        return this.prompts.get(id);
    }
    getContent(id, variables) {
        const promptInstance = this.prompts.get(id);
        if (!promptInstance) {
            throw toError(createError({
                type: "agent",
                message: `Prompt "${id}" not found`,
            }));
        }
        return promptInstance.getContent(variables);
    }
    getAll() {
        return new Map(this.prompts);
    }
    list() {
        return [...this.prompts.keys()];
    }
    has(id) {
        return this.prompts.has(id);
    }
    clear() {
        this.prompts.clear();
    }
}
// Singleton instance using globalThis to share across module contexts
// This is necessary for esbuild-bundled API routes to access the same registry
const PROMPT_REGISTRY_KEY = "__veryfront_prompt_registry__";
const globalWithRegistry = dntShim.dntGlobalThis;
export const promptRegistry = (globalWithRegistry[PROMPT_REGISTRY_KEY] ??= new PromptRegistryClass());
