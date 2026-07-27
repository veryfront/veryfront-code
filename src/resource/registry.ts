/****
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource, ResourceDefinition } from "./types.ts";
import {
  assertResourceUri,
  type CompiledResourcePattern,
  compileResourcePattern,
  extractResourcePatternParams,
  resourceTemplatePatternsOverlap,
} from "./pattern.ts";
import {
  ScopedRegistryFacade,
  ScopedRegistryView,
} from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { normalizeResourceDefinition } from "./validation.ts";

// A registry is heterogeneous by design. Parameter erasure is safe here
// because every stored resource validates unknown runtime input before calling
// its captured typed loader; results remain unknown to registry consumers.
// deno-lint-ignore no-explicit-any
type StoredResource = Resource<any, unknown>;

const compiledResourcePatterns = new WeakMap<StoredResource, CompiledResourcePattern>();

function compiledPatternFor(resource: StoredResource): CompiledResourcePattern {
  const existing = compiledResourcePatterns.get(resource);
  if (existing) return existing;
  const compiled = compileResourcePattern(resource.pattern);
  compiledResourcePatterns.set(resource, compiled);
  return compiled;
}

function assertEquivalentResourceId(
  id: string,
  existing: Pick<ResourceDefinition, "pattern">,
  incoming: Pick<ResourceDefinition, "pattern">,
): void {
  if (existing.pattern === incoming.pattern) return;
  throw new Error(
    `Cannot register resource "${id}": resource id "${id}" is already registered ` +
      `for pattern "${existing.pattern}", not "${incoming.pattern}"`,
  );
}

function assertUnambiguousResourceRegistry(
  registry: ReadonlyMap<string, StoredResource>,
): void {
  const entries = Array.from(registry);
  for (let incomingIndex = 1; incomingIndex < entries.length; incomingIndex++) {
    const [incomingId, incoming] = entries[incomingIndex]!;
    const incomingPattern = compiledPatternFor(incoming);

    for (let existingIndex = 0; existingIndex < incomingIndex; existingIndex++) {
      const [existingId, existing] = entries[existingIndex]!;
      if (existingId === incomingId) continue;

      const existingPattern = compiledPatternFor(existing);
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
}

function assertUnambiguousResourceCandidate(
  registry: ReadonlyMap<string, StoredResource>,
  id: string,
  incoming: StoredResource,
): void {
  const incomingPattern = compiledPatternFor(incoming);

  for (const [existingId, existing] of registry) {
    if (existingId === id) {
      assertEquivalentResourceId(id, existing, incoming);
      continue;
    }

    const existingPattern = compiledPatternFor(existing);
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

const resourceRegistryManager = new ProjectScopedRegistryManager<StoredResource>("resource", {
  validateRegistration: assertEquivalentResourceId,
  validateRegistryCandidate: assertUnambiguousResourceCandidate,
  validateRegistry: assertUnambiguousResourceRegistry,
});

class ResourceRegistryInternal extends ScopedRegistryFacade<StoredResource> {
  override register<TParams, TData>(
    id: string,
    resource: ResourceDefinition<TParams, TData>,
  ): void {
    const normalized = normalizeResourceDefinition(resource);
    super.register(id, normalized);
  }

  override registerShared<TParams, TData>(
    id: string,
    resource: ResourceDefinition<TParams, TData>,
  ): void {
    const normalized = normalizeResourceDefinition(resource);
    super.registerShared(id, normalized);
  }

  findEntryByPattern(uri: string): readonly [string, StoredResource] | undefined {
    assertResourceUri(uri);
    const candidates = Array.from(
      this.getAll(),
      ([id, resource]) => ({
        id,
        resource,
        pattern: compiledPatternFor(resource),
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

  findByPattern(uri: string): StoredResource | undefined {
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
class ResourceRegistry extends ScopedRegistryView<StoredResource> {
  readonly #registry: ResourceRegistryInternal;

  constructor(registry: ResourceRegistryInternal) {
    super(registry);
    this.#registry = registry;
  }

  override register<TParams, TData>(
    id: string,
    resource: ResourceDefinition<TParams, TData>,
  ): void {
    this.#registry.register(id, resource);
  }

  findEntryByPattern(uri: string): readonly [string, StoredResource] | undefined {
    return this.#registry.findEntryByPattern(uri);
  }

  findByPattern(uri: string): StoredResource | undefined {
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
