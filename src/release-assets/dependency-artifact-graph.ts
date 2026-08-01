import { ensureDefaultBundlerContracts } from "#veryfront/extensions/bundler/defaults.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { computeHashBytes } from "#veryfront/utils";
import { releaseAssetUrl } from "./constants.ts";
import type { DependencyArtifactContentType } from "./dependency-artifact-contracts.ts";

export interface DependencyArtifactSourceModule {
  id: string;
  code: string;
  contentType: DependencyArtifactContentType;
  resolutionBaseId?: string;
}

export interface DependencyArtifactAsset {
  sourceId: string;
  contentHash: string;
  contentType: DependencyArtifactContentType;
  size: number;
  bytes: Uint8Array<ArrayBuffer>;
}

export type DependencyArtifactImportResolution =
  | { kind: "module"; moduleId: string }
  | { kind: "external" }
  | { kind: "invalid"; failureCode: string };

export class DependencyArtifactGraphError extends Error {
  constructor(
    readonly failureCode: string,
    message: string,
  ) {
    super(message);
    this.name = "DependencyArtifactGraphError";
  }
}

const CSS_REFERENCE_PATTERN =
  /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?|url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
const SOURCE_MAP_REFERENCE_PATTERN =
  /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^*\s]+)\s*\*\/)/gi;
const MODULE_RELATIVE_ASSET_PATTERN =
  /new\s+URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/i;

function assertNoUnsupportedReferences(module: DependencyArtifactSourceModule): void {
  for (const match of module.code.matchAll(SOURCE_MAP_REFERENCE_PATTERN)) {
    const reference = match[1] ?? match[2];
    if (reference && !reference.startsWith("data:")) {
      throw new DependencyArtifactGraphError(
        "unsupported_asset_reference",
        "Dependency artifact contains an unsupported source map reference",
      );
    }
  }

  if (
    module.contentType === "text/javascript" &&
    MODULE_RELATIVE_ASSET_PATTERN.test(module.code)
  ) {
    throw new DependencyArtifactGraphError(
      "unsupported_asset_reference",
      "Dependency artifact contains an unsupported module-relative asset reference",
    );
  }
}

function cssSpecifiers(code: string): string[] {
  return [...code.matchAll(CSS_REFERENCE_PATTERN)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      !value.startsWith("data:") &&
      !value.startsWith("#")
    );
}

export async function readDependencyArtifactModuleSpecifiers(
  module: DependencyArtifactSourceModule,
  options: { rejectUnsupportedReferences?: boolean } = {
    rejectUnsupportedReferences: true,
  },
): Promise<string[]> {
  if (options.rejectUnsupportedReferences !== false) {
    assertNoUnsupportedReferences(module);
  }
  if (module.contentType === "text/css") return cssSpecifiers(module.code);
  await ensureDefaultBundlerContracts();
  const imports = await parseImports(module.code);
  if (
    options.rejectUnsupportedReferences !== false &&
    imports.some((specifier) => specifier.d > -1 && typeof specifier.n !== "string")
  ) {
    throw new DependencyArtifactGraphError(
      "non_literal_dynamic_import",
      "Dependency artifact contains a non-literal dynamic import",
    );
  }
  return imports
    .map((specifier) => specifier.n)
    .filter((specifier): specifier is string => typeof specifier === "string");
}

async function rewriteModuleSpecifiers(
  module: DependencyArtifactSourceModule,
  replacements: ReadonlyMap<string, string>,
): Promise<string> {
  if (module.contentType === "text/javascript") {
    return await replaceSpecifiers(module.code, (specifier) => replacements.get(specifier));
  }

  return module.code.replace(
    CSS_REFERENCE_PATTERN,
    (match, importSpecifier: string | undefined, urlSpecifier: string | undefined) => {
      const specifier = importSpecifier ?? urlSpecifier;
      if (!specifier) return match;
      const replacement = replacements.get(specifier);
      return replacement ? match.replace(specifier, replacement) : match;
    },
  );
}

function assetExtension(contentType: DependencyArtifactContentType): "js" | "css" {
  return contentType === "text/css" ? "css" : "js";
}

interface MaterializeModuleGraphInput {
  modules: ReadonlyMap<string, DependencyArtifactSourceModule>;
  entryIds: readonly string[];
  maxAssetBytes: number;
  resolveImport(
    specifier: string,
    parent: DependencyArtifactSourceModule,
  ): DependencyArtifactImportResolution;
  cycleFallbackUrl?(module: DependencyArtifactSourceModule): string | null;
  onCycle?(cycleIds: readonly string[]): void;
  assetSizeErrorMessage?(module: DependencyArtifactSourceModule): string;
  validateCompleteGraph: boolean;
}

interface MaterializedModuleGraph {
  assets: DependencyArtifactAsset[];
  remainingExternalImportCount: number;
  skippedCycleIds: Set<string>;
}

async function materializeModuleGraph(
  input: MaterializeModuleGraphInput,
): Promise<MaterializedModuleGraph> {
  const finalized = new Map<string, DependencyArtifactAsset>();
  const skippedCycleIds = new Set<string>();
  const visiting: string[] = [];
  let remainingExternalImportCount = 0;
  const encoder = new TextEncoder();

  async function finalize(moduleId: string): Promise<DependencyArtifactAsset | null> {
    const existing = finalized.get(moduleId);
    if (existing) return existing;
    if (skippedCycleIds.has(moduleId)) return null;

    const cycleIndex = visiting.indexOf(moduleId);
    if (cycleIndex !== -1) {
      if (!input.cycleFallbackUrl) {
        throw new DependencyArtifactGraphError(
          "graph_cycle",
          "Dependency artifact graph contains an unsupported import cycle",
        );
      }
      const cycleIds = [...visiting.slice(cycleIndex), moduleId];
      for (const cycleId of cycleIds) skippedCycleIds.add(cycleId);
      input.onCycle?.(cycleIds);
      return null;
    }

    const module = input.modules.get(moduleId);
    if (!module) {
      throw new DependencyArtifactGraphError(
        "graph_incomplete",
        "Dependency artifact graph references a missing module",
      );
    }

    visiting.push(moduleId);
    try {
      const replacements = new Map<string, string>();
      for (
        const specifier of await readDependencyArtifactModuleSpecifiers(module, {
          rejectUnsupportedReferences: input.validateCompleteGraph,
        })
      ) {
        const resolution = input.resolveImport(specifier, module);
        if (resolution.kind === "external") {
          remainingExternalImportCount++;
          continue;
        }
        if (resolution.kind === "invalid") {
          throw new DependencyArtifactGraphError(
            resolution.failureCode,
            "Dependency artifact graph contains an unresolved import",
          );
        }

        const child = await finalize(resolution.moduleId);
        if (!child) {
          const childModule = input.modules.get(resolution.moduleId);
          const fallback = childModule && input.cycleFallbackUrl?.(childModule);
          if (!fallback) {
            throw new DependencyArtifactGraphError(
              "graph_cycle",
              "Dependency artifact graph contains an unrepresentable import cycle",
            );
          }
          replacements.set(specifier, fallback);
          continue;
        }
        if (
          module.contentType === "text/javascript" && child.contentType !== "text/javascript"
        ) {
          throw new DependencyArtifactGraphError(
            "unsupported_asset_reference",
            "JavaScript dependency artifacts cannot import non-JavaScript assets",
          );
        }
        if (module.contentType === "text/css" && child.contentType !== "text/css") {
          throw new DependencyArtifactGraphError(
            "unsupported_asset_reference",
            "CSS dependency artifacts cannot reference non-CSS assets",
          );
        }
        replacements.set(
          specifier,
          releaseAssetUrl(child.contentHash, assetExtension(child.contentType)),
        );
      }

      if (skippedCycleIds.has(moduleId)) return null;

      const code = await rewriteModuleSpecifiers(module, replacements);
      const bytes = encoder.encode(code) as Uint8Array<ArrayBuffer>;
      if (bytes.byteLength > input.maxAssetBytes) {
        throw new DependencyArtifactGraphError(
          "asset_size_limit",
          input.assetSizeErrorMessage?.(module) ??
            "Dependency artifact asset exceeds the size limit",
        );
      }

      const asset: DependencyArtifactAsset = {
        sourceId: module.id,
        contentHash: await computeHashBytes(bytes),
        contentType: module.contentType,
        size: bytes.byteLength,
        bytes,
      };
      finalized.set(moduleId, asset);
      return asset;
    } finally {
      visiting.pop();
    }
  }

  for (const entryId of input.entryIds) await finalize(entryId);

  const assets = [...finalized.values()];
  if (input.validateCompleteGraph) {
    const contentHashes = new Set(assets.map((asset) => asset.contentHash));
    for (const asset of assets) {
      for (
        const specifier of await readDependencyArtifactModuleSpecifiers(
          {
            id: asset.sourceId,
            code: new TextDecoder().decode(asset.bytes),
            contentType: asset.contentType,
          },
          { rejectUnsupportedReferences: true },
        )
      ) {
        const resolution = input.resolveImport(specifier, input.modules.get(asset.sourceId)!);
        if (resolution.kind === "external") continue;
        const match = /^\/_vf\/assets\/([0-9a-f]{64})\.(?:js|css)$/.exec(specifier);
        if (!match?.[1] || !contentHashes.has(match[1])) {
          throw new DependencyArtifactGraphError(
            "graph_incomplete",
            "Dependency artifact graph contains a non-materialized import",
          );
        }
      }
    }
  }

  return {
    assets,
    remainingExternalImportCount,
    skippedCycleIds,
  };
}

export async function materializeDependencyArtifactGraph(input: {
  modules: ReadonlyMap<string, DependencyArtifactSourceModule>;
  rootId: string;
  maxAssetBytes: number;
  resolveImport(
    specifier: string,
    parent: DependencyArtifactSourceModule,
  ): DependencyArtifactImportResolution;
}): Promise<{
  assets: DependencyArtifactAsset[];
  rootContentHash: string;
  remainingExternalImportCount: number;
}> {
  const result = await materializeModuleGraph({
    ...input,
    entryIds: [input.rootId],
    validateCompleteGraph: true,
  });
  const root = result.assets.find((asset) => asset.sourceId === input.rootId);
  if (!root || root.contentType !== "text/javascript") {
    throw new DependencyArtifactGraphError(
      "invalid_root_content_type",
      "Dependency artifact root must be JavaScript",
    );
  }
  return {
    assets: result.assets,
    rootContentHash: root.contentHash,
    remainingExternalImportCount: result.remainingExternalImportCount,
  };
}

export async function materializeReleaseDependencyGraph(input: {
  modules: ReadonlyMap<string, DependencyArtifactSourceModule>;
  maxAssetBytes: number;
  resolveImport(
    specifier: string,
    parent: DependencyArtifactSourceModule,
  ): DependencyArtifactImportResolution;
  cycleFallbackUrl(module: DependencyArtifactSourceModule): string | null;
  onCycle(cycleIds: readonly string[]): void;
  assetSizeErrorMessage?(module: DependencyArtifactSourceModule): string;
}): Promise<{
  assets: DependencyArtifactAsset[];
  skippedCycleIds: Set<string>;
}> {
  const result = await materializeModuleGraph({
    ...input,
    entryIds: [...input.modules.keys()],
    validateCompleteGraph: false,
  });
  return { assets: result.assets, skippedCycleIds: result.skippedCycleIds };
}
