/**
 * Immutable indirection for module-graph cycle edges.
 *
 * @module rendering/orchestrator/module-loader/cycle-manifest
 */

import { CACHE_ERROR } from "#veryfront/errors";
import { dirname, isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import {
  CYCLE_MANIFEST_SIDECAR_SUFFIX,
  getCycleManifestCacheDir,
} from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";
import {
  getCycleManifestGeneration,
  isCurrentCycleManifestGeneration,
  parseCycleManifestGeneration,
} from "#veryfront/transforms/mdx/esm-module-loader/cycle-manifest-lifecycle.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

interface CycleManifestEntry {
  path: string;
  targetFilePath: string;
  isDynamic: boolean;
}

interface PersistedArtifact {
  path: string;
  exposesDefault: boolean;
  cycleBound: boolean;
}

type CachePublication = () => Promise<void>;

const CYCLE_MANIFEST_FORMAT_VERSION = 2;
const MAX_CYCLE_MANIFEST_ENTRIES = 5_000;
const JSONParse = JSON.parse;
const JSONStringify = JSON.stringify;
export { CYCLE_MANIFEST_SIDECAR_SUFFIX };
const CYCLE_MANIFEST_ROOT_MARKER = "//# veryfront-cycle-manifest:v2:";
const CYCLE_MANIFEST_MEMBER_MARKER = "//# veryfront-cycle-member:v2:";
const ROOT_TARGET_DESCRIPTOR = "$root";
const CYCLE_MANIFEST_EVIDENCE = /^[a-f0-9]{64}:[0-9]{1,5}:[1-9][0-9]{0,4}$/;
const CYCLE_MANIFEST_MEMBER_EVIDENCE = /^[A-Za-z0-9_-]{1,128}$/;
const CYCLE_BOUND_MODULE_RELATIVE_PATH =
  /^(?:0|[1-9][0-9]*)-[A-Za-z0-9_-]+\/artifacts\/[0-9a-z]+\.[A-Za-z0-9_-]{1,8}\.js$/;
const GRAPH_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isWithinDirectory(path: string, directory: string): boolean {
  const relativePath = relative(directory, path);
  return relativePath !== ".." &&
    !relativePath.startsWith("../") &&
    !relativePath.startsWith("..\\") &&
    !isAbsolute(relativePath);
}

function asModuleSpecifier(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function isCycleArtifactPath(path: string, tmpDir: string): boolean {
  const relativePath = relative(getCycleManifestCacheDir(tmpDir), path).replaceAll("\\", "/");
  return CYCLE_BOUND_MODULE_RELATIVE_PATH.test(relativePath);
}

/** Whether an immutable artifact belongs to the current source-graph snapshot. */
export function cycleArtifactBelongsToGraph(
  path: string,
  tmpDir: string,
  graphId: string,
): boolean {
  const manifestRoot = getCycleManifestCacheDir(tmpDir);
  const relativePath = relative(manifestRoot, path).replaceAll("\\", "/");
  const separator = relativePath.indexOf("/");
  if (separator === -1) return false;
  const graphDirectory = relativePath.slice(0, separator);
  const generationSeparator = graphDirectory.indexOf("-");
  const generation = parseCycleManifestGeneration(graphDirectory);
  return generation !== undefined &&
    isCurrentCycleManifestGeneration(manifestRoot, generation) &&
    graphDirectory.slice(generationSeparator + 1) === graphId &&
    CYCLE_BOUND_MODULE_RELATIVE_PATH.test(relativePath);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cycleManifestEntrySource(
  targetSpecifier: string,
  isDynamic: boolean,
  exposesDefault: boolean,
): string {
  if (isDynamic) {
    return [
      "export function then(resolve, reject) {",
      `  return import(${JSONStringify(targetSpecifier)}).then(resolve, reject);`,
      "}",
    ].join("\n");
  }

  const lines = [`export * from ${JSONStringify(targetSpecifier)};`];
  if (exposesDefault) {
    lines.push(`export { default } from ${JSONStringify(targetSpecifier)};`);
  }
  return lines.join("\n");
}

/** One transform graph's cycle entries and delayed cache publications. */
export class CycleManifestTransaction {
  readonly #tmpDir: string;
  readonly #evidenceBaseDir: string;
  readonly #manifestRootDir: string;
  readonly #generation: number;
  readonly #graphId: string;
  readonly #manifestDir: string;
  readonly #entries: CycleManifestEntry[] = [];
  readonly #artifacts = new Map<string, PersistedArtifact>();
  readonly #artifactPaths = new Map<string, string>();
  readonly #artifactIds: ReadonlyMap<string, string>;
  readonly #entryIds = new Map<string, string>();
  readonly #cycleBoundSources: Set<string>;
  readonly #dependencyWaits = new Map<string, Set<string>>();
  readonly #cachePublications: CachePublication[] = [];
  #rootArtifactPath: string | undefined;
  #rootSourcePath: string | undefined;
  #rootExposesDefault = false;
  #rootIsCycleBound = false;
  #rootEvidence: { digest: string; entryCount: number; artifactCount: number } | undefined;
  #sealedArtifactDescriptors: [string, string][] | undefined;
  #committed = false;

  constructor(
    tmpDir: string,
    graphId = crypto.randomUUID().replaceAll("-", ""),
    artifactIds: ReadonlyMap<string, string> = new Map(),
  ) {
    if (!GRAPH_ID.test(graphId)) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest graph identity is invalid" });
    }
    this.#tmpDir = tmpDir;
    this.#evidenceBaseDir = dirname(tmpDir);
    this.#graphId = graphId;
    this.#manifestRootDir = getCycleManifestCacheDir(tmpDir);
    this.#generation = getCycleManifestGeneration(this.#manifestRootDir);
    this.#manifestDir = join(this.#manifestRootDir, `${this.#generation}-${graphId}`);
    this.#artifactIds = artifactIds;
    this.#cycleBoundSources = new Set();
  }

  /** Reserve an immutable module path for one edge before its target hash exists. */
  registerEdge(
    targetFilePath: string,
    importerFilePath: string,
    isDynamic: boolean,
    plannedId?: string,
  ): string {
    if (this.#committed) {
      throw CACHE_ERROR.create({ detail: "Cannot extend a committed cycle manifest" });
    }
    this.#cycleBoundSources.add(importerFilePath);
    this.#cycleBoundSources.add(targetFilePath);
    if (!isDynamic) return this.reserveArtifactPath(targetFilePath);

    const edgeKey = JSONStringify([importerFilePath, targetFilePath, true]);
    const existingPath = this.#entryIds.get(edgeKey);
    if (existingPath) return existingPath;
    if (this.#entries.length >= MAX_CYCLE_MANIFEST_ENTRIES) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest entry limit exceeded" });
    }

    const entryId = plannedId ?? this.#entries.length.toString(36);
    if (!/^[0-9a-z-]{1,128}$/.test(entryId)) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest entry identity is invalid" });
    }
    const entryPath = join(this.#manifestDir, `${entryId}.js`);
    this.#entryIds.set(edgeKey, entryPath);
    this.#entries.push({ path: entryPath, targetFilePath, isDynamic });
    return entryPath;
  }

  /** Mark an importer whose persisted artifact depends on a cycle-bound child. */
  markCycleBound(filePath: string): void {
    this.#cycleBoundSources.add(filePath);
  }

  /** Whether this source belongs to the ancestry of a cycle-closing edge. */
  isCycleBound(filePath: string): boolean {
    return this.#cycleBoundSources.has(filePath);
  }

  /** Track one recursive wait, or decline it when it would deadlock the graph. */
  beginDependencyWait(importerFilePath: string, targetFilePath: string): (() => void) | null {
    if (this.#hasDependencyPath(targetFilePath, importerFilePath)) return null;
    let targets = this.#dependencyWaits.get(importerFilePath);
    if (!targets) {
      targets = new Set();
      this.#dependencyWaits.set(importerFilePath, targets);
    }
    targets.add(targetFilePath);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      targets!.delete(targetFilePath);
      if (targets!.size === 0) this.#dependencyWaits.delete(importerFilePath);
    };
  }

  #hasDependencyPath(startFilePath: string, targetFilePath: string): boolean {
    if (startFilePath === targetFilePath) return true;
    const visited = new Set([startFilePath]);
    const pending = [startFilePath];
    for (let index = 0; index < pending.length; index++) {
      for (const dependency of this.#dependencyWaits.get(pending[index]!) ?? []) {
        if (dependency === targetFilePath) return true;
        if (visited.has(dependency)) continue;
        visited.add(dependency);
        pending.push(dependency);
      }
    }
    return false;
  }

  /** Allocate one graph-content-addressed artifact path outside authored paths. */
  reserveArtifactPath(filePath: string): string {
    if (!this.#cycleBoundSources.has(filePath)) {
      throw CACHE_ERROR.create({ detail: "Cannot reserve an artifact outside a cycle closure" });
    }
    const existing = this.#artifactPaths.get(filePath);
    if (existing) return existing;

    const artifactId = this.#artifactIds.get(filePath) ??
      this.#artifactPaths.size.toString(36);
    const path = join(
      this.#manifestDir,
      "artifacts",
      `${artifactId}.${this.#graphId.slice(0, 8)}.js`,
    );
    this.#artifactPaths.set(filePath, path);
    return path;
  }

  /** Record the content-addressed artifact produced for a source module. */
  recordArtifact(
    filePath: string,
    path: string,
    exposesDefault: boolean,
    isGraphRoot = false,
  ): void {
    this.#artifacts.set(filePath, {
      path,
      exposesDefault,
      cycleBound: this.#cycleBoundSources.has(filePath),
    });
    if (isGraphRoot) {
      this.#rootArtifactPath = path;
      this.#rootIsCycleBound = this.#cycleBoundSources.has(filePath);
    }
  }

  /** Whether this graph needs export metadata for the source module. */
  referencesStaticTarget(filePath: string): boolean {
    return this.#entries.some((entry) => !entry.isDynamic && entry.targetFilePath === filePath);
  }

  /** Whether a cycle-closing edge addresses this source through the manifest. */
  referencesTarget(filePath: string): boolean {
    return this.#entries.some((entry) => entry.targetFilePath === filePath);
  }

  /** Delay publication until every cycle entry is durable. */
  deferCachePublication(publication: CachePublication): void {
    this.#cachePublications.push(publication);
  }

  /** Mark a cycle member so a later root lookup fails closed without a sidecar. */
  markMemberArtifactCode(code: string): string {
    return `${code}\n${CYCLE_MANIFEST_MEMBER_MARKER}${this.#graphId}\n`;
  }

  /** Bind the complete manifest entry set to the graph root's immutable bytes. */
  async sealRootArtifactCode(
    code: string,
    rootSourcePath: string,
    rootExposesDefault: boolean,
    localAdapter: RuntimeAdapter,
  ): Promise<string> {
    this.#rootSourcePath = rootSourcePath;
    this.#rootExposesDefault = rootExposesDefault;
    const entryDescriptors = this.#entryDescriptors();
    const artifactDescriptors = await this.#artifactDescriptors(localAdapter, code);
    const digest = await computeHash(JSONStringify({
      entries: entryDescriptors,
      artifacts: artifactDescriptors,
    }));
    this.#sealedArtifactDescriptors = artifactDescriptors;
    this.#rootEvidence = {
      digest,
      entryCount: entryDescriptors.length,
      artifactCount: artifactDescriptors.length,
    };
    return `${code}\n${CYCLE_MANIFEST_ROOT_MARKER}${digest}:` +
      `${entryDescriptors.length}:${artifactDescriptors.length}\n`;
  }

  async #artifactDescriptors(
    localAdapter: RuntimeAdapter,
    rootCode?: string,
  ): Promise<[string, string][]> {
    if (!this.#rootSourcePath) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest graph root is not initialized" });
    }
    const descriptors: [string, string][] = [];
    for (const [sourcePath, artifact] of this.#artifacts) {
      if (!artifact.cycleBound || sourcePath === this.#rootSourcePath) continue;
      let raw: string | Uint8Array;
      try {
        raw = await localAdapter.fs.readFile(artifact.path);
      } catch (error) {
        throw CACHE_ERROR.create({
          detail: "Failed to read a cycle manifest artifact",
          cause: error,
        });
      }
      const code = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      descriptors.push([
        relative(this.#evidenceBaseDir, artifact.path).replaceAll("\\", "/"),
        await computeHash(code),
      ]);
    }
    if (rootCode === undefined) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest root bytes are not initialized" });
    }
    descriptors.push([ROOT_TARGET_DESCRIPTOR, await computeHash(rootCode)]);
    return descriptors.sort(([left], [right]) => compareText(left, right));
  }

  #entryDescriptors(): [string, string, boolean, boolean][] {
    if (!this.#rootSourcePath) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest graph root is not initialized" });
    }
    return this.#entries
      .map((entry): [string, string, boolean, boolean] => {
        if (entry.targetFilePath === this.#rootSourcePath) {
          return [
            relative(this.#evidenceBaseDir, entry.path).replaceAll("\\", "/"),
            ROOT_TARGET_DESCRIPTOR,
            entry.isDynamic,
            this.#rootExposesDefault,
          ];
        }
        const target = this.#artifacts.get(entry.targetFilePath);
        if (!target) {
          throw CACHE_ERROR.create({ detail: "Cycle manifest target metadata is incomplete" });
        }
        return [
          relative(this.#evidenceBaseDir, entry.path).replaceAll("\\", "/"),
          relative(this.#evidenceBaseDir, target.path).replaceAll("\\", "/"),
          entry.isDynamic,
          target.exposesDefault,
        ];
      })
      .sort(([left], [right]) => compareText(left, right));
  }

  /** Persist all entries, then make the graph's caches visible. */
  async commit(localAdapter: RuntimeAdapter): Promise<void> {
    if (this.#committed) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest transaction was already committed" });
    }
    this.#committed = true;

    if (getCycleManifestGeneration(this.#manifestRootDir) !== this.#generation) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest generation was invalidated" });
    }

    if (this.#rootIsCycleBound) {
      if (
        !this.#rootArtifactPath ||
        !this.#rootIsCycleBound ||
        !this.#rootEvidence ||
        this.#rootEvidence.entryCount !== this.#entries.length ||
        !isWithinDirectory(this.#rootArtifactPath, this.#tmpDir) &&
          !isCycleArtifactPath(this.#rootArtifactPath, this.#tmpDir)
      ) {
        throw CACHE_ERROR.create({
          detail: "Cycle manifest has no durable graph root artifact",
        });
      }
      let rootExists: boolean;
      try {
        rootExists = await localAdapter.fs.exists(this.#rootArtifactPath);
      } catch (error) {
        throw CACHE_ERROR.create({
          detail: "Failed to validate cycle manifest graph root",
          cause: error,
        });
      }
      if (!rootExists) {
        throw CACHE_ERROR.create({
          detail: "Cycle manifest has no durable graph root artifact",
        });
      }
      try {
        await localAdapter.fs.mkdir(this.#manifestDir, { recursive: true });
      } catch (error) {
        throw CACHE_ERROR.create({
          detail: "Failed to persist cycle manifest directory",
          cause: error,
        });
      }

      for (const entry of this.#entries) {
        const target = this.#artifacts.get(entry.targetFilePath);
        let targetExists = false;
        if (target) {
          try {
            targetExists = await localAdapter.fs.exists(target.path);
          } catch (error) {
            throw CACHE_ERROR.create({
              detail: "Failed to validate cycle manifest target",
              cause: error,
            });
          }
        }
        if (
          !target ||
          !target.cycleBound ||
          !isWithinDirectory(target.path, this.#manifestRootDir) ||
          !isCycleArtifactPath(target.path, this.#tmpDir) ||
          !targetExists
        ) {
          throw CACHE_ERROR.create({
            detail: "Cycle manifest target is not a durable content-hashed module artifact",
          });
        }

        const targetSpecifier = asModuleSpecifier(relative(dirname(entry.path), target.path));

        try {
          await localAdapter.fs.writeFile(
            entry.path,
            cycleManifestEntrySource(
              targetSpecifier,
              entry.isDynamic,
              target.exposesDefault,
            ),
          );
        } catch (error) {
          throw CACHE_ERROR.create({
            detail: "Failed to persist cycle manifest entry",
            cause: error,
          });
        }
      }

      const serializedEntries = this.#entries.map((entry) => {
        const target = this.#artifacts.get(entry.targetFilePath)!;
        return [
          relative(this.#evidenceBaseDir, entry.path).replaceAll("\\", "/"),
          relative(this.#evidenceBaseDir, target.path).replaceAll("\\", "/"),
          entry.isDynamic,
          target.exposesDefault,
        ];
      }).sort(([left], [right]) => compareText(String(left), String(right)));
      const rootArtifact = await localAdapter.fs.readFile(this.#rootArtifactPath);
      const decodedRoot = typeof rootArtifact === "string"
        ? rootArtifact
        : new TextDecoder().decode(rootArtifact);
      const rootCode = rootCodeWithoutEvidence(decodedRoot);
      if (rootCode === undefined) {
        throw CACHE_ERROR.create({ detail: "Cycle manifest root evidence is missing" });
      }
      const artifactDescriptors = await this.#artifactDescriptors(localAdapter, rootCode);
      const digest = await computeHash(JSONStringify({
        entries: this.#entryDescriptors(),
        artifacts: artifactDescriptors,
      }));
      if (
        digest !== this.#rootEvidence.digest ||
        artifactDescriptors.length !== this.#rootEvidence.artifactCount ||
        JSONStringify(artifactDescriptors) !== JSONStringify(this.#sealedArtifactDescriptors)
      ) {
        throw CACHE_ERROR.create({ detail: "Cycle manifest changed after its root was sealed" });
      }
      const serializedArtifacts = artifactDescriptors.map(([path, contentDigest]) => [
        path === ROOT_TARGET_DESCRIPTOR
          ? relative(this.#evidenceBaseDir, this.#rootArtifactPath!).replaceAll("\\", "/")
          : path,
        contentDigest,
        path === ROOT_TARGET_DESCRIPTOR,
      ]);
      const serializedManifest = JSONStringify({
        version: CYCLE_MANIFEST_FORMAT_VERSION,
        root: relative(this.#evidenceBaseDir, this.#rootArtifactPath).replaceAll("\\", "/"),
        digest: this.#rootEvidence.digest,
        entryCount: this.#rootEvidence.entryCount,
        artifactCount: this.#rootEvidence.artifactCount,
        entries: serializedEntries,
        artifacts: serializedArtifacts,
      });
      try {
        await localAdapter.fs.writeFile(
          `${this.#rootArtifactPath}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`,
          serializedManifest,
        );
      } catch (error) {
        throw CACHE_ERROR.create({
          detail: "Failed to persist cycle manifest cache evidence",
          cause: error,
        });
      }
    }

    if (getCycleManifestGeneration(this.#manifestRootDir) !== this.#generation) {
      throw CACHE_ERROR.create({ detail: "Cycle manifest generation was invalidated" });
    }
    for (const publish of this.#cachePublications) await publish();
  }
}

export type CycleManifestCacheState = "none" | "valid-root" | "invalid";

function rootEvidenceFromCode(
  code: string,
): { digest: string; entryCount: number; artifactCount: number } | undefined {
  const markerIndex = code.lastIndexOf(`\n${CYCLE_MANIFEST_ROOT_MARKER}`);
  if (markerIndex === -1) return undefined;
  const evidence = code.slice(markerIndex + 1 + CYCLE_MANIFEST_ROOT_MARKER.length).trimEnd();
  if (!CYCLE_MANIFEST_EVIDENCE.test(evidence)) return undefined;
  const parts = evidence.split(":");
  return {
    digest: parts[0]!,
    entryCount: Number(parts[1]),
    artifactCount: Number(parts[2]),
  };
}

function rootCodeWithoutEvidence(code: string): string | undefined {
  const markerIndex = code.lastIndexOf(`\n${CYCLE_MANIFEST_ROOT_MARKER}`);
  return markerIndex === -1 ? undefined : code.slice(0, markerIndex);
}

function hasCycleMarker(code: string): boolean {
  if (rootEvidenceFromCode(code) !== undefined) return true;
  const markerIndex = code.lastIndexOf(`\n${CYCLE_MANIFEST_MEMBER_MARKER}`);
  if (markerIndex === -1) return false;
  const evidence = code.slice(markerIndex + 1 + CYCLE_MANIFEST_MEMBER_MARKER.length).trimEnd();
  return CYCLE_MANIFEST_MEMBER_EVIDENCE.test(evidence);
}

/** Validate the immutable cycle closure associated with a cached artifact. */
export async function inspectCycleManifestCache(
  modulePath: string,
  tmpDir: string,
  localAdapter: RuntimeAdapter,
): Promise<CycleManifestCacheState> {
  const evidenceBaseDir = dirname(tmpDir);
  const manifestRootDir = getCycleManifestCacheDir(tmpDir);
  let raw: string | Uint8Array;
  try {
    raw = await localAdapter.fs.readFile(`${modulePath}${CYCLE_MANIFEST_SIDECAR_SUFFIX}`);
  } catch (error) {
    if (!isNotFoundError(error)) return "invalid";
    if (isCycleArtifactPath(modulePath, tmpDir)) return "invalid";
    try {
      const module = await localAdapter.fs.readFile(modulePath);
      const decodedModule = typeof module === "string" ? module : new TextDecoder().decode(module);
      return hasCycleMarker(decodedModule) ? "invalid" : "none";
    } catch {
      return "invalid";
    }
  }

  try {
    const decoded = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const parsed: unknown = JSONParse(decoded);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "invalid";
    const record = parsed as Record<string, unknown>;
    if (
      record.version !== CYCLE_MANIFEST_FORMAT_VERSION ||
      typeof record.root !== "string" ||
      typeof record.digest !== "string" ||
      typeof record.entryCount !== "number" ||
      typeof record.artifactCount !== "number" ||
      !Array.isArray(record.entries) ||
      !Array.isArray(record.artifacts) ||
      record.entries.length > MAX_CYCLE_MANIFEST_ENTRIES ||
      record.artifacts.length === 0 ||
      record.artifacts.length > MAX_CYCLE_MANIFEST_ENTRIES
    ) {
      return "invalid";
    }

    const rootPath = join(evidenceBaseDir, record.root);
    if (
      !isWithinDirectory(rootPath, tmpDir) && !isCycleArtifactPath(rootPath, tmpDir) ||
      !await localAdapter.fs.exists(rootPath)
    ) {
      return "invalid";
    }
    const rootArtifact = await localAdapter.fs.readFile(rootPath);
    const decodedRoot = typeof rootArtifact === "string"
      ? rootArtifact
      : new TextDecoder().decode(rootArtifact);
    const rootEvidence = rootEvidenceFromCode(decodedRoot);
    if (
      !rootEvidence ||
      rootEvidence.digest !== record.digest ||
      rootEvidence.entryCount !== record.entryCount ||
      rootEvidence.artifactCount !== record.artifactCount ||
      record.entryCount !== record.entries.length ||
      record.artifactCount !== record.artifacts.length
    ) {
      return "invalid";
    }

    const descriptors: [string, string, boolean, boolean][] = [];
    for (const value of record.entries) {
      if (
        !Array.isArray(value) || value.length !== 4 ||
        typeof value[0] !== "string" || typeof value[1] !== "string" ||
        typeof value[2] !== "boolean" || typeof value[3] !== "boolean"
      ) {
        return "invalid";
      }
      const entryPath = join(evidenceBaseDir, value[0]);
      const targetPath = join(evidenceBaseDir, value[1]);
      const targetSpecifier = asModuleSpecifier(relative(dirname(entryPath), targetPath));
      if (
        !isWithinDirectory(entryPath, manifestRootDir) ||
        !isWithinDirectory(targetPath, manifestRootDir) ||
        !isCycleArtifactPath(targetPath, tmpDir) ||
        !await localAdapter.fs.exists(targetPath)
      ) {
        return "invalid";
      }
      const entry = await localAdapter.fs.readFile(entryPath);
      const decodedEntry = typeof entry === "string" ? entry : new TextDecoder().decode(entry);
      if (decodedEntry !== cycleManifestEntrySource(targetSpecifier, value[2], value[3])) {
        return "invalid";
      }
      descriptors.push([
        relative(evidenceBaseDir, entryPath).replaceAll("\\", "/"),
        targetPath === rootPath
          ? ROOT_TARGET_DESCRIPTOR
          : relative(evidenceBaseDir, targetPath).replaceAll("\\", "/"),
        value[2],
        value[3],
      ]);
    }
    descriptors.sort(([left], [right]) => compareText(left, right));
    const artifactDescriptors: [string, string][] = [];
    let foundRootArtifact = false;
    for (const value of record.artifacts) {
      if (
        !Array.isArray(value) || value.length !== 3 ||
        typeof value[0] !== "string" || typeof value[1] !== "string" ||
        typeof value[2] !== "boolean" || !/^[a-f0-9]{64}$/.test(value[1])
      ) {
        return "invalid";
      }
      const artifactPath = join(evidenceBaseDir, value[0]);
      const isRoot = value[2];
      if (
        isRoot && foundRootArtifact ||
        isRoot && artifactPath !== rootPath ||
        !isRoot && !isCycleArtifactPath(artifactPath, tmpDir) ||
        !await localAdapter.fs.exists(artifactPath)
      ) {
        return "invalid";
      }
      const artifact = await localAdapter.fs.readFile(artifactPath);
      const decodedArtifact = typeof artifact === "string"
        ? artifact
        : new TextDecoder().decode(artifact);
      const artifactCode = isRoot ? rootCodeWithoutEvidence(decodedArtifact) : decodedArtifact;
      if (artifactCode === undefined || await computeHash(artifactCode) !== value[1]) {
        return "invalid";
      }
      if (isRoot) foundRootArtifact = true;
      artifactDescriptors.push([
        isRoot
          ? ROOT_TARGET_DESCRIPTOR
          : relative(evidenceBaseDir, artifactPath).replaceAll("\\", "/"),
        value[1],
      ]);
    }
    if (!foundRootArtifact) return "invalid";
    artifactDescriptors.sort(([left], [right]) => compareText(left, right));
    const digest = await computeHash(JSONStringify({
      entries: descriptors,
      artifacts: artifactDescriptors,
    }));
    if (digest !== record.digest) return "invalid";
    return rootPath === modulePath ? "valid-root" : "invalid";
  } catch {
    return "invalid";
  }
}

/** Whether persistence changes the authored extension to a hashed JavaScript artifact. */
export function needsCycleManifest(filePath: string): boolean {
  return /\.(?:tsx?|jsx?|mdx)$/.test(filePath);
}
