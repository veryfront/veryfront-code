/**
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */

import type { Resource } from "./types.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { snapshotResourceDefinition } from "./definition.ts";
import {
  assertResourceUri,
  type CompiledResourcePattern,
  compileResourcePattern,
  decodeResourceParams,
  hasUnresolvedGeneratedResourcePattern,
  matchResourcePattern,
  resourcePatternsOverlap,
} from "./pattern.ts";

function sameResourceDefinition(existing: Resource, incoming: Resource): boolean {
  return existing.id === incoming.id && existing.pattern === incoming.pattern &&
    existing.description === incoming.description && existing.title === incoming.title &&
    existing.paramsSchema === incoming.paramsSchema && existing.load === incoming.load &&
    existing.subscribe === incoming.subscribe && existing.mcp?.enabled === incoming.mcp?.enabled &&
    existing.mcp?.cachePolicy === incoming.mcp?.cachePolicy;
}

const resourceRegistryManager = new ProjectScopedRegistryManager<Resource>("resource", {
  validateRegistration(id, existing, incoming) {
    if (sameResourceDefinition(existing, incoming)) return;
    throw INVALID_ARGUMENT.create({
      detail: `Resource registry already contains a conflicting definition for "${id}"`,
    });
  },
});

class ResourceRegistry extends ScopedRegistryFacade<Resource> {
  private readonly compiledPatterns = new WeakMap<Resource, CompiledResourcePattern>();

  override register(id: string, item: Resource): void {
    this.assertResolvedPattern(item);
    const snapshot = snapshotResourceDefinition(item, id);
    const compiled = compileResourcePattern(snapshot.pattern);
    this.assertNoAmbiguousPattern(id, compiled);
    this.compiledPatterns.set(snapshot, compiled);
    super.register(id, snapshot);
  }

  override registerShared(id: string, item: Resource): void {
    this.assertResolvedPattern(item);
    const snapshot = snapshotResourceDefinition(item, id);
    const existing = this.getShared(id);
    if (existing !== undefined && !sameResourceDefinition(existing, snapshot)) {
      throw INVALID_ARGUMENT.create({
        detail: `Resource registry already contains a conflicting definition for "${id}"`,
      });
    }
    const compiled = compileResourcePattern(snapshot.pattern);
    this.assertNoAmbiguousPattern(id, compiled);
    this.compiledPatterns.set(snapshot, compiled);
    super.registerShared(id, snapshot);
  }

  private compiled(resource: Resource): CompiledResourcePattern {
    const cached = this.compiledPatterns.get(resource);
    if (cached) return cached;
    const compiled = compileResourcePattern(resource.pattern);
    this.compiledPatterns.set(resource, compiled);
    return compiled;
  }

  private assertResolvedPattern(resource: Resource): void {
    if (hasUnresolvedGeneratedResourcePattern(resource)) {
      throw INVALID_ARGUMENT.create({
        detail: "Directly registered resources must define an explicit URI pattern",
      });
    }
  }

  private assertNoAmbiguousPattern(id: string, incoming: CompiledResourcePattern): void {
    for (const [existingId, resource] of this.getAll()) {
      if (existingId === id) continue;
      const existing = this.compiled(resource);
      if (existing.structuralKey === incoming.structuralKey) {
        throw INVALID_ARGUMENT.create({
          detail: "Resource registry patterns must have distinct URI structures",
        });
      }
      if (
        existing.parameterNames.length === incoming.parameterNames.length &&
        existing.literalLength === incoming.literalLength &&
        resourcePatternsOverlap(existing, incoming)
      ) {
        throw INVALID_ARGUMENT.create({
          detail: "Overlapping resource registry patterns must have distinct specificity",
        });
      }
    }
  }

  findByPattern(uri: string): Resource | undefined {
    const validatedUri = assertResourceUri(uri);
    let best:
      | { resource: Resource; compiled: CompiledResourcePattern }
      | undefined;

    for (const resource of this.getAll().values()) {
      const compiled = this.compiled(resource);
      if (!matchResourcePattern(validatedUri, compiled)) continue;
      if (!best || this.isMoreSpecific(compiled, best.compiled)) {
        best = { resource, compiled };
      }
    }
    return best?.resource;
  }

  private isMoreSpecific(
    candidate: CompiledResourcePattern,
    current: CompiledResourcePattern,
  ): boolean {
    if (candidate.parameterNames.length !== current.parameterNames.length) {
      return candidate.parameterNames.length < current.parameterNames.length;
    }
    return candidate.literalLength > current.literalLength;
  }

  extractParams(uri: string, pattern: string): Record<string, string> {
    const validatedUri = assertResourceUri(uri);
    const compiled = compileResourcePattern(pattern);
    const captures = matchResourcePattern(validatedUri, compiled);
    return captures ? decodeResourceParams(captures, compiled) : {};
  }

  /** Convert a parameterized resource pattern to its MCP URI-template form. */
  toUriTemplate(pattern: string): string | undefined {
    return compileResourcePattern(pattern).uriTemplate;
  }

  list(): string[] {
    return this.getAllIds();
  }
}

/** Shared resource registry value. */
export const resourceRegistry = new ResourceRegistry(resourceRegistryManager);
