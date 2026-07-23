import { extract } from "#std/front-matter/yaml.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import {
  isExtendedFSAdapter,
  isVirtualFilesystem,
} from "#veryfront/platform/adapters/fs/wrapper.ts";
import { detectEntityType, normalizeFrontmatter } from "../entities.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/index.ts";
import { DEFAULT_MAX_FILE_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import {
  DYNAMIC_ROUTE_ERROR,
  INVALID_ROUTE_FILE,
  ROUTE_CONFLICT,
} from "#veryfront/errors/error-registry/route.ts";

const logger = baseLogger.component("get-entity-by-slug");

const fs = createFileSystem();
const MAX_ENTITY_SOURCE_BYTES = DEFAULT_MAX_FILE_SIZE_BYTES;
const MAX_ROUTE_SEGMENTS = 64;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_DYNAMIC_DIRECTORIES = 1_024;
const MAX_DYNAMIC_ENTRIES = 100_000;
const textEncoder = new TextEncoder();
const PAGE_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const DIRECT_ROUTE_EXTENSIONS = PAGE_FILE_EXTENSIONS;
const LAYOUT_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const OPTIONAL_CATCH_ALL_PAGE_PATTERN = /^\[\[\.\.\.[^\[\]\/]+\]\]\.(mdx|md|tsx|jsx|ts|js)$/i;
const CATCH_ALL_PAGE_PATTERN = /^\[\.\.\.[^\[\]\/]+\]\.(mdx|md|tsx|jsx|ts|js)$/i;
const SINGLE_SEGMENT_PAGE_PATTERN = /^\[[^\[\]\/]+\]\.(mdx|md|tsx|jsx|ts|js)$/i;
const OPTIONAL_CATCH_ALL_DIRECTORY_PATTERN = /^\[\[\.\.\.[^\[\]\/]+\]\]$/;
const CATCH_ALL_DIRECTORY_PATTERN = /^\[\.\.\.[^\[\]\/]+\]$/;
const SINGLE_SEGMENT_DIRECTORY_PATTERN = /^\[[^\[\]\/]+\]$/;
const SUPPORTED_PAGE_EXTENSION_PATTERN = /\.(mdx|md|tsx|jsx|ts|js)$/i;

type DirectoryEntry = { name: string; isFile: boolean; isDirectory: boolean };
type EntityCandidate = { path: string; root: string; virtualRoot: string };
type DynamicTraversalBudget = { directoriesVisited: number; entriesInspected: number };

/**
 * Reads and classifies one entity source file.
 *
 * Returns `null` when the source path does not identify a file. Adapter failures
 * other than a missing path are propagated to the caller.
 */
export async function getEntityInfo(
  filePath: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  if (!isBoundedPath(filePath)) return null;
  return await withSpan(
    "types.getEntityInfo",
    async () => {
      const shouldReadDirectly = adapter
        ? isExtendedFSAdapter(adapter.fs) && adapter.fs.isVeryfrontAdapter()
        : false;

      let content: string;
      try {
        if (adapter) {
          if (!shouldReadDirectly) {
            const stat = await adapter.fs.stat(filePath);
            if (!stat.isFile) return null;
            assertEntitySourceSize(stat.size);
          }

          content = await adapter.fs.readFile(filePath);
        } else {
          const stat = await fs.stat(filePath);
          if (!stat.isFile) return null;
          assertEntitySourceSize(stat.size);
          content = await fs.readTextFile(filePath);
        }
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }

      if (typeof content !== "string") {
        throw INVALID_ROUTE_FILE.create({
          detail: "Entity source adapter returned non-text content",
        });
      }
      assertEntitySourceSize(
        content.length > MAX_ENTITY_SOURCE_BYTES
          ? content.length
          : textEncoder.encode(content).byteLength,
      );

      const ext = pathHelper.extname(filePath).toLowerCase();

      let frontmatter: Frontmatter = {};
      let body = content;

      if (ext === ".md" || ext === ".mdx") {
        try {
          const extracted = extract(content);
          frontmatter = normalizeFrontmatter(extracted.attrs);
          body = extracted.body;
        } catch {
          /* expected: malformed YAML frontmatter */
        }
      }

      const fileName = splitPathSegments(filePath).at(-1) ?? "";
      const { type, kind, isLayout, isComponent, isPage } = detectEntityType(
        fileName,
        frontmatter,
      );

      let entityId = filePath;
      if (adapter) {
        const adapterFs = adapter.fs;
        if (isExtendedFSAdapter(adapterFs) && adapterFs.isVeryfrontAdapter()) {
          const underlyingAdapter = adapterFs.getUnderlyingAdapter();

          if (underlyingAdapter) {
            const getEntityIdForPath = Reflect.get(underlyingAdapter, "getEntityIdForPath");
            if (typeof getEntityIdForPath === "function") {
              const resolvedEntityId = Reflect.apply(
                getEntityIdForPath,
                underlyingAdapter,
                [filePath],
              );
              if (resolvedEntityId !== undefined) {
                if (!isBoundedIdentifier(resolvedEntityId)) {
                  throw INVALID_ROUTE_FILE.create({
                    detail: "Entity identifier is invalid",
                  });
                }
                entityId = resolvedEntityId;
              }
            }
          }
        }
      }

      const entity: Entity = {
        id: entityId,
        path: filePath,
        slug: getSlugFromPath(filePath),
        type,
        content: body,
        frontmatter,
        kind,
        isLayout,
        isComponent,
        isPage,
      };

      return { entity };
    },
    { "entity.extension": pathHelper.extname(filePath).toLowerCase() },
  );
}

/**
 * Resolves a page entity for a project-relative route slug.
 *
 * Resolution checks exact page files, directory index files, and dynamic route
 * files without allowing candidates to escape the project root.
 */
export async function getEntityBySlug(
  projectDir: string,
  slug: string,
  adapter?: RuntimeAdapter,
  pagesDirectory = "pages",
): Promise<EntityInfo | null> {
  return await withSpan(
    "types.getEntityBySlug",
    async () => {
      const normalizedSlug = normalizeSlug(slug);
      if (
        !isBoundedPath(projectDir) ||
        !isSafeRouteSlug(normalizedSlug) ||
        !isSafeProjectRelativePath(pagesDirectory) ||
        countPathSegments(normalizedSlug) > MAX_ROUTE_SEGMENTS
      ) return null;

      const isVeryfrontRoute = normalizedSlug.startsWith(".veryfront/") ||
        normalizedSlug === ".veryfront";
      const resolveFile = adapter?.fs.resolveFile;
      const pagesRoot = pathHelper.join(projectDir, pagesDirectory);
      const pageStems = buildPageStems(normalizedSlug);

      logger.debug("Resolving page entity", {
        routeSegmentCount: countPathSegments(normalizedSlug),
        isVeryfrontRoute,
        hasResolveFile: !!resolveFile,
      });

      if (resolveFile) {
        const basePaths: EntityCandidate[] = pageStems.map((stem) => ({
          path: pathHelper.join(pagesRoot, stem),
          root: projectDir,
          virtualRoot: pagesDirectory,
        }));
        let directCandidateCount = 0;

        if (isVeryfrontRoute) {
          basePaths.unshift({
            path: pathHelper.join(projectDir, normalizedSlug),
            root: projectDir,
            virtualRoot: "",
          });
          directCandidateCount = 1;
        }
        logger.debug("Resolving adapter page candidates", {
          candidateCount: basePaths.length,
        });

        const candidateResults = await parallelMap(basePaths, async (candidate) => {
          const resolvedPath = await resolveFile.call(adapter.fs, candidate.path);
          logger.debug("Adapter page candidate resolved", {
            resolved: resolvedPath !== null,
          });
          if (resolvedPath === null) return null;
          if (typeof resolvedPath !== "string" || !isBoundedPath(resolvedPath)) {
            throw DYNAMIC_ROUTE_ERROR.create({
              detail: "Route adapter returned an invalid resolved path",
            });
          }
          return await getEntityInfoWithinRoot(
            resolvedPath,
            candidate.root,
            adapter,
            candidate.virtualRoot,
          );
        });

        if (directCandidateCount > 0) {
          const directPage = selectUniquePage(
            candidateResults.slice(0, directCandidateCount).filter(isPageEntityInfo),
            countPathSegments(normalizedSlug),
            "exact",
          );
          if (directPage) return withResolvedSlug(directPage, normalizedSlug);
        }
        const exactPage = selectUniquePage(
          candidateResults.slice(directCandidateCount).filter(isPageEntityInfo),
          countPathSegments(normalizedSlug),
          "exact",
        );
        if (exactPage) {
          logger.debug("Resolved page entity", {
            routeSegmentCount: countPathSegments(normalizedSlug),
          });
          return withResolvedSlug(exactPage, normalizedSlug);
        }

        const dynamicPage = await findDynamicPageEntity(
          projectDir,
          normalizedSlug,
          adapter,
          pagesDirectory,
        );
        if (dynamicPage) return withResolvedSlug(dynamicPage, normalizedSlug);

        logger.debug("Page entity was not found", {
          routeSegmentCount: countPathSegments(normalizedSlug),
        });
        return null;
      }

      const candidates: EntityCandidate[] = pageStems.flatMap((stem) =>
        buildFileCandidates(
          projectDir,
          [pagesDirectory],
          stem,
          PAGE_FILE_EXTENSIONS,
        ).map((path) => ({ path, root: projectDir, virtualRoot: pagesDirectory }))
      );

      let directCandidateCount = 0;
      if (isVeryfrontRoute) {
        const directCandidates = buildFileCandidates(
          projectDir,
          [],
          normalizedSlug,
          DIRECT_ROUTE_EXTENSIONS,
        ).map(
          (path) => ({ path, root: projectDir, virtualRoot: "" }),
        );
        directCandidateCount = directCandidates.length;
        candidates.unshift(...directCandidates);
      }

      const candidateResults = await parallelMap(candidates, async (candidate) => {
        return await getEntityInfoWithinRoot(
          candidate.path,
          candidate.root,
          adapter,
          candidate.virtualRoot,
        );
      });

      if (directCandidateCount > 0) {
        const directPage = selectUniquePage(
          candidateResults.slice(0, directCandidateCount).filter(isPageEntityInfo),
          countPathSegments(normalizedSlug),
          "exact",
        );
        if (directPage) return withResolvedSlug(directPage, normalizedSlug);
      }

      const exactPage = selectUniquePage(
        candidateResults.slice(directCandidateCount).filter(isPageEntityInfo),
        countPathSegments(normalizedSlug),
        "exact",
      );
      if (exactPage) return withResolvedSlug(exactPage, normalizedSlug);

      const dynamicPage = await findDynamicPageEntity(
        projectDir,
        normalizedSlug,
        adapter,
        pagesDirectory,
      );
      return dynamicPage ? withResolvedSlug(dynamicPage, normalizedSlug) : null;
    },
    {
      "entity.route_segments": countPathSegments(normalizeSlug(slug)),
    },
  );
}

/**
 * Resolves a layout entity by alias, project-relative path, or naming convention.
 *
 * Returns `null` when the requested layout cannot be found inside the project root.
 */
export async function getLayoutEntity(
  projectDir: string,
  layoutName: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  if (!isBoundedPath(projectDir) || !isBoundedPath(layoutName)) return null;
  return await withSpan(
    "types.getLayoutEntity",
    async () => {
      let resolvedLayoutName = layoutName;
      if (layoutName.startsWith("@components/")) {
        resolvedLayoutName = layoutName.replace("@components/", "components/");
      } else if (layoutName.startsWith("@/")) {
        resolvedLayoutName = layoutName.substring(2);
      }

      if (!isSafeProjectRelativePath(resolvedLayoutName)) return null;

      if (/\.(mdx|md|tsx|jsx|ts|js)$/i.test(resolvedLayoutName)) {
        const directPath = pathHelper.join(projectDir, resolvedLayoutName);
        const info = await getEntityInfoWithinRoot(directPath, projectDir, adapter);
        if (info?.entity.isLayout) return info;
        // If explicit path with extension fails, don't fall back to convention-based discovery
        return null;
      }

      // Files in layouts/ are treated as layouts by convention (any extension)
      const layoutCandidatePaths = buildFileCandidates(
        projectDir,
        ["layouts"],
        resolvedLayoutName,
        LAYOUT_FILE_EXTENSIONS,
      );

      // Files in components/ must be detected as layouts by name/frontmatter
      const componentLayoutPaths = buildFileCandidates(
        projectDir,
        ["components"],
        `${resolvedLayoutName}Layout`,
        LAYOUT_FILE_EXTENSIONS,
      );
      const componentFallbackPaths = buildFileCandidates(
        projectDir,
        ["components"],
        "Layout",
        LAYOUT_FILE_EXTENSIONS,
      );

      const candidateResults = await parallelMap(
        [...layoutCandidatePaths, ...componentLayoutPaths, ...componentFallbackPaths],
        async (candidatePath) => {
          return await getEntityInfoWithinRoot(candidatePath, projectDir, adapter);
        },
      );

      const layoutEnd = layoutCandidatePaths.length;
      const componentEnd = layoutEnd + componentLayoutPaths.length;
      const conventionalLayout = selectUniqueLayout(
        candidateResults.slice(0, layoutEnd).filter(isEntityInfo),
      );
      if (conventionalLayout) return conventionalLayout;

      const componentLayout = selectUniqueLayout(
        candidateResults.slice(layoutEnd, componentEnd).filter(isLayoutEntityInfo),
      );
      if (componentLayout) return componentLayout;

      const fallbackLayout = selectUniqueLayout(
        candidateResults.slice(componentEnd).filter(isLayoutEntityInfo),
      );
      if (fallbackLayout) return fallbackLayout;

      return null;
    },
    { "layout.has_name": layoutName.length > 0 },
  );
}

function buildFileCandidates(
  projectDir: string,
  segments: string[],
  relativeStem: string,
  extensions: readonly string[],
): string[] {
  return extensions.map((extension) =>
    pathHelper.join(projectDir, ...segments, `${relativeStem}.${extension}`)
  );
}

function buildPageStems(normalizedSlug: string): string[] {
  return normalizedSlug === "" || normalizedSlug === "index"
    ? ["index"]
    : [normalizedSlug, `${normalizedSlug}/index`];
}

async function findDynamicPageEntity(
  projectDir: string,
  normalizedSlug: string,
  adapter?: RuntimeAdapter,
  pagesDirectory = "pages",
): Promise<EntityInfo | null> {
  const slugParts = normalizedSlug === "" || normalizedSlug === "index"
    ? []
    : normalizedSlug.split("/");
  const pagesRoot = pathHelper.join(projectDir, pagesDirectory);
  return await findPageInDirectory(
    pagesRoot,
    projectDir,
    pagesDirectory,
    slugParts,
    0,
    adapter,
    0,
    { directoriesVisited: 0, entriesInspected: 0 },
  );
}

async function findPageInDirectory(
  directoryPath: string,
  projectDir: string,
  pagesDirectory: string,
  slugParts: readonly string[],
  segmentIndex: number,
  adapter: RuntimeAdapter | undefined,
  dynamicDirectoryDepth: number,
  budget: DynamicTraversalBudget,
): Promise<EntityInfo | null> {
  budget.directoriesVisited += 1;
  if (budget.directoriesVisited > MAX_DYNAMIC_DIRECTORIES) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail:
        `Dynamic route directory traversal exceeds the ${MAX_DYNAMIC_DIRECTORIES}-directory limit`,
    });
  }
  if (dynamicDirectoryDepth > slugParts.length + 1) return null;
  if (!await isWithinRoot(directoryPath, projectDir, adapter, pagesDirectory)) return null;

  let entries: DirectoryEntry[];
  try {
    if (!await pagesDirectoryExists(directoryPath, adapter)) return null;
    entries = (await readDirectoryEntries(directoryPath, adapter)).filter((entry) =>
      isSafeDirectoryEntryName(entry.name)
    );
    budget.entriesInspected += entries.length;
    if (budget.entriesInspected > MAX_DYNAMIC_ENTRIES) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `Dynamic route traversal exceeds the ${MAX_DYNAMIC_ENTRIES}-entry limit`,
      });
    }
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  const remainingSegmentCount = slugParts.length - segmentIndex;
  const exactResults: EntityInfo[] = [];

  if (remainingSegmentCount === 0) {
    exactResults.push(
      ...await loadPageEntries(
        directoryPath,
        entries.filter((entry) => entry.isFile && isPageFileStem(entry.name, "index")),
        projectDir,
        adapter,
        pagesDirectory,
      ),
    );
  } else {
    const segment = slugParts[segmentIndex] ?? "";
    if (remainingSegmentCount === 1) {
      exactResults.push(
        ...await loadPageEntries(
          directoryPath,
          entries.filter((entry) => entry.isFile && isPageFileStem(entry.name, segment)),
          projectDir,
          adapter,
          pagesDirectory,
        ),
      );
    }

    const literalDirectory = entries.find((entry) => entry.isDirectory && entry.name === segment);
    if (literalDirectory) {
      const nested = await findPageInDirectory(
        pathHelper.join(directoryPath, literalDirectory.name),
        projectDir,
        pagesDirectory,
        slugParts,
        segmentIndex + 1,
        adapter,
        dynamicDirectoryDepth,
        budget,
      );
      if (nested) exactResults.push(nested);
    }
  }

  const exactPage = selectUniquePage(exactResults, slugParts.length, "exact");
  if (exactPage) return exactPage;

  const dynamicFiles = entries
    .filter((entry) => entry.isFile)
    .map((entry) => ({
      entry,
      priority: getDynamicPagePriority(entry.name, remainingSegmentCount),
    }))
    .filter(
      (candidate): candidate is { entry: DirectoryEntry; priority: number } =>
        candidate.priority !== null,
    );
  const dynamicDirectories = entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({
      entry,
      match: getDynamicDirectoryMatch(entry.name, remainingSegmentCount),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        entry: DirectoryEntry;
        match: { consumedSegments: number; priority: number };
      } => candidate.match !== null,
    );

  for (const priority of [0, 1, 2]) {
    const matches: EntityInfo[] = await loadPageEntries(
      directoryPath,
      dynamicFiles
        .filter((candidate) => candidate.priority === priority)
        .map((candidate) => candidate.entry),
      projectDir,
      adapter,
      pagesDirectory,
    );

    for (const candidate of dynamicDirectories) {
      if (candidate.match.priority !== priority) continue;
      const nested = await findPageInDirectory(
        pathHelper.join(directoryPath, candidate.entry.name),
        projectDir,
        pagesDirectory,
        slugParts,
        segmentIndex + candidate.match.consumedSegments,
        adapter,
        dynamicDirectoryDepth + 1,
        budget,
      );
      if (nested) matches.push(nested);
    }

    const page = selectUniquePage(matches, slugParts.length, "dynamic");
    if (page) return page;
  }

  return null;
}

function getDynamicPagePriority(
  fileName: string,
  remainingSegmentCount: number,
): number | null {
  if (OPTIONAL_CATCH_ALL_PAGE_PATTERN.test(fileName)) return 2;
  if (CATCH_ALL_PAGE_PATTERN.test(fileName)) return remainingSegmentCount > 0 ? 1 : null;
  if (SINGLE_SEGMENT_PAGE_PATTERN.test(fileName)) {
    return remainingSegmentCount === 1 ? 0 : null;
  }
  return null;
}

function getDynamicDirectoryMatch(
  directoryName: string,
  remainingSegmentCount: number,
): { consumedSegments: number; priority: number } | null {
  if (OPTIONAL_CATCH_ALL_DIRECTORY_PATTERN.test(directoryName)) {
    return { consumedSegments: remainingSegmentCount, priority: 2 };
  }
  if (CATCH_ALL_DIRECTORY_PATTERN.test(directoryName)) {
    return remainingSegmentCount > 0
      ? { consumedSegments: remainingSegmentCount, priority: 1 }
      : null;
  }
  if (SINGLE_SEGMENT_DIRECTORY_PATTERN.test(directoryName)) {
    return remainingSegmentCount > 0 ? { consumedSegments: 1, priority: 0 } : null;
  }
  return null;
}

function isPageFileStem(fileName: string, expectedStem: string): boolean {
  if (!SUPPORTED_PAGE_EXTENSION_PATTERN.test(fileName)) return false;
  return fileName.replace(SUPPORTED_PAGE_EXTENSION_PATTERN, "") === expectedStem;
}

function isSafeDirectoryEntryName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." &&
    !name.includes("\0") && !name.includes("/") && !name.includes("\\");
}

async function loadPageEntries(
  directoryPath: string,
  entries: readonly DirectoryEntry[],
  projectDir: string,
  adapter: RuntimeAdapter | undefined,
  pagesDirectory: string,
): Promise<EntityInfo[]> {
  const candidates = await parallelMap(entries, async (entry) => {
    const info = await getEntityInfoWithinRoot(
      pathHelper.join(directoryPath, entry.name),
      projectDir,
      adapter,
      pagesDirectory,
    );
    return info?.entity.isPage ? info : null;
  });
  return candidates.filter((candidate): candidate is EntityInfo => candidate !== null);
}

function selectUniquePage(
  candidates: readonly EntityInfo[],
  routeSegmentCount: number,
  matchKind: "dynamic" | "exact",
): EntityInfo | null {
  const uniqueCandidates = new Map<string, EntityInfo>();
  for (const candidate of candidates) {
    uniqueCandidates.set(candidate.entity.path, candidate);
  }
  if (uniqueCandidates.size > 1) {
    throw ROUTE_CONFLICT.create({
      detail: `Multiple ${matchKind} page files match the same route`,
      context: { candidateCount: uniqueCandidates.size, routeSegmentCount },
    });
  }
  return uniqueCandidates.values().next().value ?? null;
}

function isPageEntityInfo(candidate: EntityInfo | null): candidate is EntityInfo {
  return candidate?.entity.isPage === true;
}

function withResolvedSlug(info: EntityInfo, normalizedSlug: string): EntityInfo {
  return {
    ...info,
    entity: {
      ...info.entity,
      slug: normalizedSlug === "index" ? "" : normalizedSlug,
    },
  };
}

async function pagesDirectoryExists(
  pagesDir: string,
  adapter?: RuntimeAdapter,
): Promise<boolean> {
  if (!adapter) return await fs.exists(pagesDir);

  try {
    const stat = await adapter.fs.stat(pagesDir);
    return stat.isDirectory;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    /* expected: directory may not exist */
    return false;
  }
}

async function readDirectoryEntries(
  pagesDir: string,
  adapter?: RuntimeAdapter,
): Promise<DirectoryEntry[]> {
  const entries: DirectoryEntry[] = [];
  const iterator = adapter?.fs.readDir ? adapter.fs.readDir(pagesDir) : fs.readDir(pagesDir);

  for await (const entry of iterator) {
    if (entries.length >= MAX_DIRECTORY_ENTRIES) {
      throw DYNAMIC_ROUTE_ERROR.create({
        detail: `Route directory entries exceed the ${MAX_DIRECTORY_ENTRIES}-entry limit`,
      });
    }
    entries.push(snapshotDirectoryEntry(entry));
  }

  return entries;
}

function getSlugFromPath(filePath: string): string {
  const parts = splitPathSegments(filePath);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?)$/i, "");
  if (slug.toLowerCase() !== "index") return slug;

  const pagesIndex = parts.findLastIndex((part) => part.toLowerCase() === "pages");
  if (pagesIndex >= 0) return parts.slice(pagesIndex + 1, -1).join("/");
  const parentDir = parts[parts.length - 2];
  return parentDir?.toLowerCase() === "pages" ? "" : parentDir ?? "";
}

function splitPathSegments(filePath: string): string[] {
  return filePath.split(/[\\/]/);
}

function normalizeSlug(slug: string): string {
  return slug.split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
}

function countPathSegments(path: string): number {
  return path === "" ? 0 : path.split("/").filter(Boolean).length;
}

function isSafeProjectRelativePath(path: string): boolean {
  return isBoundedPath(path) &&
    !pathHelper.isAbsolute(path) &&
    path.split(/[\\/]/).every((segment) => segment !== "..");
}

function isSafeRouteSlug(slug: string): boolean {
  return isSafeProjectRelativePath(slug) && !slug.includes("\\");
}

function isBoundedPath(path: unknown): path is string {
  return typeof path === "string" && path.length <= MAX_PATH_LENGTH_CHARS &&
    !path.includes("\0");
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PATH_LENGTH_CHARS && !value.includes("\0");
}

function assertEntitySourceSize(size: unknown): void {
  if (size === undefined) return;
  if (
    typeof size === "number" && Number.isSafeInteger(size) && size >= 0 &&
    size <= MAX_ENTITY_SOURCE_BYTES
  ) return;
  throw INVALID_ROUTE_FILE.create({
    detail: `Entity source exceeds the ${MAX_ENTITY_SOURCE_BYTES}-byte limit`,
  });
}

function snapshotDirectoryEntry(value: unknown): DirectoryEntry {
  if (typeof value !== "object" || value === null) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid directory entry",
    });
  }
  let nameDescriptor: PropertyDescriptor | undefined;
  let isFileDescriptor: PropertyDescriptor | undefined;
  let isDirectoryDescriptor: PropertyDescriptor | undefined;
  try {
    nameDescriptor = Reflect.getOwnPropertyDescriptor(value, "name");
    isFileDescriptor = Reflect.getOwnPropertyDescriptor(value, "isFile");
    isDirectoryDescriptor = Reflect.getOwnPropertyDescriptor(value, "isDirectory");
  } catch {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an unreadable directory entry",
    });
  }
  if (
    !nameDescriptor?.enumerable || !("value" in nameDescriptor) ||
    !isFileDescriptor?.enumerable || !("value" in isFileDescriptor) ||
    !isDirectoryDescriptor?.enumerable || !("value" in isDirectoryDescriptor)
  ) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid directory entry",
    });
  }
  const name: unknown = nameDescriptor.value;
  const isFile: unknown = isFileDescriptor.value;
  const isDirectory: unknown = isDirectoryDescriptor.value;
  if (
    typeof name !== "string" || typeof isFile !== "boolean" ||
    typeof isDirectory !== "boolean"
  ) {
    throw DYNAMIC_ROUTE_ERROR.create({
      detail: "Route adapter returned an invalid directory entry",
    });
  }
  return Object.freeze({ name, isFile, isDirectory });
}

function isEntityInfo(value: EntityInfo | null): value is EntityInfo {
  return value !== null;
}

function isLayoutEntityInfo(value: EntityInfo | null): value is EntityInfo {
  return value?.entity.isLayout === true;
}

function selectUniqueLayout(candidates: readonly EntityInfo[]): EntityInfo | null {
  if (candidates.length > 1) {
    throw ROUTE_CONFLICT.create({
      detail: "Multiple layout files match the same layout",
      context: { candidateCount: candidates.length },
    });
  }
  const info = candidates[0];
  if (!info) return null;
  return {
    ...info,
    entity: {
      ...info.entity,
      type: "layout",
      isLayout: true,
      isComponent: false,
      isPage: false,
    },
  };
}

async function getEntityInfoWithinRoot(
  filePath: string,
  rootDir: string,
  adapter?: RuntimeAdapter,
  virtualRoot = "",
): Promise<EntityInfo | null> {
  if (!await isWithinRoot(filePath, rootDir, adapter, virtualRoot)) return null;
  return await getEntityInfo(filePath, adapter);
}

async function isWithinRoot(
  filePath: string,
  rootDir: string,
  adapter?: RuntimeAdapter,
  virtualRoot = "",
): Promise<boolean> {
  try {
    if (adapter?.fs.realPath) {
      const canonicalPath = await adapter.fs.realPath(filePath);
      const canonicalRoot = await adapter.fs.realPath(rootDir);
      return hasPathPrefix(canonicalPath, canonicalRoot);
    }

    if (adapter) {
      if (!isVirtualFilesystem(adapter.fs)) return false;
      if (filePath.split(/[\\/]/).some((segment) => segment === "..")) return false;
      if (pathHelper.isAbsolute(filePath)) return hasPathPrefix(filePath, rootDir);

      const comparisonRoot = virtualRoot;
      return comparisonRoot === "" || comparisonRoot === "."
        ? true
        : hasPathPrefix(filePath, comparisonRoot);
    }

    const canonicalPath = await realPath(filePath);
    const canonicalRoot = await realPath(rootDir);
    return hasPathPrefix(canonicalPath, canonicalRoot);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    /* expected: candidate or root may not exist */
    return false;
  }
}

function hasPathPrefix(filePath: string, rootDir: string): boolean {
  const normalizedPath = normalizeComparablePath(filePath);
  const normalizedRoot = normalizeComparablePath(rootDir);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizeComparablePath(path: string): string {
  const normalized = pathHelper.normalize(path.replace(/\\/g, "/")).replace(/\/$/, "");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}
