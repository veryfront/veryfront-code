/****
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource } from "./types.ts";
import {
  compileResourcePattern,
  extractResourcePatternParams,
  resourceTemplatePatternsOverlap,
} from "./pattern.ts";
import {
  ScopedRegistryFacade,
  ScopedRegistryView,
} from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

function assertEquivalentResourceId(
  id: string,
  existing: Pick<Resource, "pattern">,
  incoming: Pick<Resource, "pattern">,
): void {
  if (existing.pattern === incoming.pattern) return;
  throw new Error(
    `Cannot register resource "${id}": resource id "${id}" is already registered ` +
      `for pattern "${existing.pattern}", not "${incoming.pattern}"`,
  );
}

const resourceRegistryManager = new ProjectScopedRegistryManager<Resource>("resource", {
  validateRegistration: assertEquivalentResourceId,
});

class ResourceRegistryInternal extends ScopedRegistryFacade<Resource> {
  override register<TParams, TData>(
    id: string,
    resource: Resource<TParams, TData>,
  ): void {
    this.assertUnambiguousRegistration(id, resource);
    super.register(id, resource as unknown as Resource);
  }

  override registerShared<TParams, TData>(
    id: string,
    resource: Resource<TParams, TData>,
  ): void {
    this.assertUnambiguousRegistration(id, resource);
    super.registerShared(id, resource as unknown as Resource);
  }

  private assertUnambiguousRegistration<TParams, TData>(
    id: string,
    incoming: Resource<TParams, TData>,
  ): void {
    const incomingPattern = compileResourcePattern(incoming.pattern);

    for (const [existingId, existing] of this.getAll()) {
      if (existingId === id) {
        assertEquivalentResourceId(id, existing, incoming);
        continue;
      }

      const existingPattern = compileResourcePattern(existing.pattern);
      if (
        existingPattern.signature === incomingPattern.signature ||
        resourceTemplatePatternsOverlap(existingPattern, incomingPattern)
      ) {
        throw new Error(
          `Resource pattern "${incoming.pattern}" conflicts with registered resource ` +
            `"${existingId}" using pattern "${existing.pattern}"`,
        );
      }
    }
  }

  findEntryByPattern(uri: string): readonly [string, Resource] | undefined {
    const candidates = Array.from(
      this.getAll(),
      ([id, resource]) => ({
        id,
        resource,
        pattern: compileResourcePattern(resource.pattern),
      }),
    );

    for (const candidate of candidates) {
      if (!candidate.pattern.isTemplate && candidate.pattern.expression.test(uri)) {
        return [candidate.id, candidate.resource];
      }
    }
    for (const candidate of candidates) {
      if (candidate.pattern.isTemplate && candidate.pattern.expression.test(uri)) {
        return [candidate.id, candidate.resource];
      }
    }
    return undefined;
  }

  findByPattern(uri: string): Resource | undefined {
    return this.findEntryByPattern(uri)?.[1];
  }

  isTemplatePattern(pattern: string): boolean {
    return compileResourcePattern(pattern).isTemplate;
  }

  toUriTemplate(pattern: string): string {
    return compileResourcePattern(pattern).template;
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    return extractResourcePatternParams(uri, compileResourcePattern(pattern));
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Framework-only resource registry with process-wide maintenance capabilities. */
export const resourceRegistryInternal = new ResourceRegistryInternal(resourceRegistryManager);

/** Project-scoped resource registry API safe for application code. */
class ResourceRegistry extends ScopedRegistryView<Resource> {
  readonly #registry: ResourceRegistryInternal;

  constructor(registry: ResourceRegistryInternal) {
    super(registry);
    this.#registry = registry;
  }

  override register<TParams, TData>(
    id: string,
    resource: Resource<TParams, TData>,
  ): void {
    this.#registry.register(id, resource);
  }

  findEntryByPattern(uri: string): readonly [string, Resource] | undefined {
    return this.#registry.findEntryByPattern(uri);
  }

  findByPattern(uri: string): Resource | undefined {
    return this.#registry.findByPattern(uri);
  }

  isTemplatePattern(pattern: string): boolean {
    return this.#registry.isTemplatePattern(pattern);
  }

  toUriTemplate(pattern: string): string {
    return this.#registry.toUriTemplate(pattern);
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    return this.#registry.extractParams(uri, pattern);
  }

  list(): string[] {
    return this.#registry.list();
  }
}

/** Project-scoped resource registry value. */
export const resourceRegistry = new ResourceRegistry(resourceRegistryInternal);
