import * as dntShim from "../../_dnt.shims.js";
import { agentLogger } from "../utils/logger/logger.js";
class ResourceRegistryClass {
    resources = new Map();
    register(id, resourceInstance) {
        if (this.resources.has(id)) {
            agentLogger.debug(`Resource "${id}" is already registered. Overwriting.`);
        }
        this.resources.set(id, resourceInstance);
    }
    get(id) {
        return this.resources.get(id);
    }
    findByPattern(uri) {
        for (const resource of this.resources.values()) {
            if (this.matchesPattern(uri, resource.pattern))
                return resource;
        }
        return undefined;
    }
    patternToRegex(pattern) {
        return new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
    }
    matchesPattern(uri, pattern) {
        return this.patternToRegex(pattern).test(uri);
    }
    extractParams(uri, pattern) {
        return uri.match(this.patternToRegex(pattern))?.groups ?? {};
    }
    getAll() {
        return new Map(this.resources);
    }
    list() {
        return [...this.resources.keys()];
    }
    has(id) {
        return this.resources.has(id);
    }
    clear() {
        this.resources.clear();
    }
}
const RESOURCE_REGISTRY_KEY = "__veryfront_resource_registry__";
const globalWithRegistry = dntShim.dntGlobalThis;
export const resourceRegistry = (globalWithRegistry[RESOURCE_REGISTRY_KEY] ??= new ResourceRegistryClass());
