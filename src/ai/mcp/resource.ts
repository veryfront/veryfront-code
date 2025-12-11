
import type { Resource, ResourceConfig } from "../types/mcp.ts";
import { agentLogger } from "../../core/utils/logger/logger.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export function resource<TParams = any, TData = any>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  const pattern = config.pattern || generateResourcePattern();

  const id = patternToId(pattern);

  return {
    id,
    pattern,
    description: config.description,
    paramsSchema: config.paramsSchema,
    load: async (params: TParams) => {
      try {
        config.paramsSchema.parse(params);
      } catch (error) {
        throw toError(createError({
          type: "agent",
          message: `Resource "${id}" params validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }));
      }

      return await config.load(params);
    },
    subscribe: config.subscribe,
    mcp: config.mcp,
  };
}

function generateResourcePattern(): string {
  return `/resource_${Date.now()}`;
}

function patternToId(pattern: string): string {
  return pattern
    .replace(/^\
    .replace(/\
    .replace(/:/g, "");
}

class ResourceRegistryClass {
  private resources = new Map<string, Resource>();

  register(id: string, resourceInstance: Resource): void {
    if (this.resources.has(id)) {
      agentLogger.debug(`Resource "${id}" is already registered. Overwriting.`);
    }

    this.resources.set(id, resourceInstance);
  }

  get(id: string): Resource | undefined {
    return this.resources.get(id);
  }

  findByPattern(uri: string): Resource | undefined {
    for (const resource of this.resources.values()) {
      if (this.matchesPattern(uri, resource.pattern)) {
        return resource;
      }
    }
    return undefined;
  }

  private matchesPattern(uri: string, pattern: string): boolean {
    const patternRegex = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$",
    );
    return patternRegex.test(uri);
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    const patternRegex = new RegExp(
      "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$",
    );
    const match = uri.match(patternRegex);

    return match?.groups || {};
  }

  getAll(): Map<string, Resource> {
    return new Map(this.resources);
  }

  clear(): void {
    this.resources.clear();
  }
}

const RESOURCE_REGISTRY_KEY = "__veryfront_resource_registry__";
// deno-lint-ignore no-explicit-any
const _globalResource = globalThis as any;
export const resourceRegistry: ResourceRegistryClass = _globalResource[RESOURCE_REGISTRY_KEY] ||=
  new ResourceRegistryClass();
