import { dirname, join, normalize } from "veryfront/platform/path";
import { inspectOkfDocument } from "veryfront/knowledge";
import type { IgnoreChecker } from "./ignore.ts";

interface OkfSyncFile {
  path: string;
  content?: string;
}

const OKF_COMPANION_REFERENCE_KEYS = new Set([
  "attester",
  "computation",
  "executor",
  "resource",
  "sources",
]);
const OKF_COMPANION_PATH_KEYS = new Set(["path", "resource"]);

function looksLikeExternalOkfReference(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("#");
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function hasOkfVersionDeclaration(metadata: Record<string, unknown>): boolean {
  const version = Object.getOwnPropertyDescriptor(metadata, "okf_version")?.value;
  return (typeof version === "string" && version.trim().length > 0) ||
    (typeof version === "number" && Number.isFinite(version));
}

function hasOkfDocumentClassification(metadata: Record<string, unknown>): boolean {
  const type = Object.getOwnPropertyDescriptor(metadata, "type")?.value;
  return hasOkfVersionDeclaration(metadata) || (typeof type === "string" && type.trim().length > 0);
}

function collectOkfBundleRoots(
  files: readonly OkfSyncFile[],
): Set<string> {
  const roots = new Set<string>();
  for (const file of files) {
    if (!file.path.endsWith("/index.md") && file.path !== "index.md") continue;
    if (typeof file.content !== "string") continue;
    const inspected = inspectOkfDocument(file.path, file.content);
    if (!hasOkfVersionDeclaration(inspected.metadata)) continue;
    const root = dirname(file.path).replace(/\\/g, "/");
    roots.add(root === "." ? "" : root);
  }
  return roots;
}

function collectOkfBundleRootCandidates(
  documentPath: string,
  declaredBundleRoots: ReadonlySet<string>,
  availablePaths: ReadonlySet<string>,
): string[] {
  const segments = documentPath.split("/");
  for (let length = segments.length - 1; length >= 0; length--) {
    const prefix = segments.slice(0, length).join("/");
    if (declaredBundleRoots.has(prefix)) return [prefix];
  }

  const candidates: string[] = [];
  for (let length = 1; length < segments.length; length++) {
    const prefix = segments.slice(0, length).join("/");
    if (availablePaths.has(`${prefix}/index.md`) && !candidates.includes(prefix)) {
      candidates.push(prefix);
    }
  }
  const topLevelRoot = segments.length > 1 ? segments[0] ?? "" : "";
  if (candidates.length === 0) {
    return topLevelRoot ? [topLevelRoot, ""] : [""];
  }

  if (
    availablePaths.has("index.md") && candidates[0] === topLevelRoot && !candidates.includes("")
  ) {
    candidates.push("");
  }
  if (topLevelRoot && !candidates.includes(topLevelRoot)) candidates.push(topLevelRoot);
  return candidates;
}

function isInsideOkfRoot(path: string, root: string): boolean {
  return !root || path === root || path.startsWith(`${root}/`);
}

function isInsideAnyOkfRoot(path: string, roots: readonly string[]): boolean {
  if (roots.includes("")) return true;
  const scopedRoots = roots.filter((root) => root.length > 0);
  if (scopedRoots.length === 0) return true;
  return scopedRoots.some((root) => isInsideOkfRoot(path, root));
}

function resolveOkfCompanionCandidates(
  documentPath: string,
  reference: string,
  bundleRoots: readonly string[],
): string[] {
  const trimmed = reference.trim();
  if (!trimmed || looksLikeExternalOkfReference(trimmed)) return [];

  const [withoutHash] = trimmed.split("#", 1);
  const [withoutQuery] = (withoutHash ?? "").split("?", 1);
  const path = withoutQuery?.trim();
  if (!path) return [];

  const referencePath = path.replace(/^\/+/, "");
  const rootFallbacks = bundleRoots.map((root) => ({
    root,
    rawPath: root ? join(root, referencePath) : referencePath,
  }));
  const documentDir = dirname(documentPath).replace(/\\/g, "/");
  const rawPaths: { rawPath: string; root?: string }[] = path.startsWith("/")
    ? rootFallbacks
    : documentDir === "."
    ? rootFallbacks
    : [{ rawPath: join(documentDir, path) }, ...rootFallbacks];
  const candidates: string[] = [];
  for (const entry of rawPaths) {
    const normalized = normalize(entry.rawPath).replace(/\\/g, "/").replace(/^\/+/, "");
    if (
      !normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") ||
      normalized.split("/").includes("..")
    ) {
      continue;
    }
    if (
      entry.root === undefined
        ? !isInsideAnyOkfRoot(normalized, bundleRoots)
        : !isInsideOkfRoot(normalized, entry.root)
    ) {
      continue;
    }
    if (!candidates.includes(normalized)) candidates.push(normalized);
  }
  return candidates;
}

function collectOkfReferencesFromValue(input: {
  documentPath: string;
  value: unknown;
  key?: string;
  insideCompanionField: boolean;
  referencedPaths: Set<string>;
  availablePaths: Set<string>;
  bundleRoots: readonly string[];
}): void {
  const insideCompanionField = input.insideCompanionField ||
    (input.key !== undefined && OKF_COMPANION_REFERENCE_KEYS.has(input.key));
  if (typeof input.value === "string") {
    if (insideCompanionField) {
      const candidates = resolveOkfCompanionCandidates(
        input.documentPath,
        input.value,
        input.bundleRoots,
      );
      const existingCandidate = candidates.find((candidate) => input.availablePaths.has(candidate));
      const referencedPath = existingCandidate ?? candidates[0];
      if (referencedPath !== undefined) input.referencedPaths.add(referencedPath);
    }
    return;
  }
  if (Array.isArray(input.value)) {
    for (const item of input.value) {
      collectOkfReferencesFromValue({
        documentPath: input.documentPath,
        value: item,
        insideCompanionField,
        referencedPaths: input.referencedPaths,
        availablePaths: input.availablePaths,
        bundleRoots: input.bundleRoots,
      });
    }
    return;
  }
  if (input.value == null || typeof input.value !== "object") return;
  for (const [key, value] of Object.entries(input.value)) {
    collectOkfReferencesFromValue({
      documentPath: input.documentPath,
      value,
      key,
      insideCompanionField: insideCompanionField && OKF_COMPANION_PATH_KEYS.has(key),
      referencedPaths: input.referencedPaths,
      availablePaths: input.availablePaths,
      bundleRoots: input.bundleRoots,
    });
  }
}

/** Find explicitly referenced OKF assets within the declared bundle roots. */
export function collectReferencedOkfCompanions(
  files: readonly OkfSyncFile[],
  ignoreChecker: IgnoreChecker,
  availablePaths = new Set(files.map((file) => file.path)),
): Set<string> {
  const bundleRoots = collectOkfBundleRoots(files);
  const referencedPaths = new Set<string>();
  for (const file of files) {
    if (
      ignoreChecker.isIgnored(file.path) ||
      !isMarkdownPath(file.path) ||
      typeof file.content !== "string"
    ) continue;
    const inspected = inspectOkfDocument(file.path, file.content);
    if (!hasOkfDocumentClassification(inspected.metadata)) continue;
    collectOkfReferencesFromValue({
      documentPath: file.path,
      value: inspected.metadata,
      insideCompanionField: false,
      referencedPaths,
      availablePaths,
      bundleRoots: collectOkfBundleRootCandidates(file.path, bundleRoots, availablePaths),
    });
  }
  return referencedPaths;
}

export interface OkfBundleMetadata {
  _veryfront: { okf: { bundle_root_path: string } };
}

/** Annotate declared native knowledge bundle members without rewriting their bytes. */
export function annotateOkfBundleMembers<T extends OkfSyncFile>(files: readonly T[]): (T & {
  metadata?: OkfBundleMetadata;
})[] {
  const roots = collectOkfBundleRoots(files);
  return files.map((file) => {
    const path = file.path;
    if (
      path.includes("\\") || path.includes("\0") || path.startsWith("/") ||
      path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) return file;
    const segments = path.split("/");
    for (let length = segments.length - 1; length > 0; length--) {
      const root = segments.slice(0, length).join("/");
      if (roots.has(root)) {
        if ((root === "knowledge" || root.startsWith("knowledge/")) && root.length <= 1024) {
          return { ...file, metadata: { _veryfront: { okf: { bundle_root_path: root } } } };
        }
        break;
      }
    }
    return file;
  });
}
