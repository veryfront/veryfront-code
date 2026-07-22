import { extract } from "#std/front-matter/yaml.ts";
import {
  createFileSystem,
  isNotFoundError as isPlatformNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isExtendedFSAdapter, NotSupportedError } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { detectEntityType } from "../entities.ts";
import { createErrorScope } from "#veryfront/errors/error-context.ts";
import { fromError } from "#veryfront/errors/veryfront-error.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { getSpecificityScore, parseRoute } from "#veryfront/routing/matchers/route-parser.ts";
import { matchRoute } from "#veryfront/routing/matchers/route-matcher.ts";

const logger = baseLogger.component("get-entity-by-slug");

const entityInfoScope = createErrorScope("getEntityInfo");
const fs = createFileSystem();
const PAGE_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const DIRECT_ROUTE_EXTENSIONS = PAGE_FILE_EXTENSIONS;
const LAYOUT_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const DYNAMIC_PAGE_ENTRY_PATTERN = /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/;

type DirectoryEntry = { name: string; isFile: boolean; isDirectory: boolean };

const UNSUPPORTED_OPERATION_CODES = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP"]);

function errorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === "object" && error !== null ? error as Record<string, unknown> : null;
}

function isUnsupportedFileSystemOperation(error: unknown): boolean {
  if (error instanceof NotSupportedError) return true;

  const record = errorRecord(error);
  if (
    record?.name === "NotSupportedError" ||
    record?.name === "NotSupported" ||
    record?.slug === "not-supported" ||
    (typeof record?.code === "string" && UNSUPPORTED_OPERATION_CODES.has(record.code))
  ) {
    return true;
  }

  return fromError(error)?.type === "not_supported";
}

function isFileNotFoundError(error: unknown): boolean {
  if (isPlatformNotFoundError(error)) return true;

  const record = errorRecord(error);
  if (record?.name === "NotFound" || record?.slug === "file-not-found") {
    return true;
  }

  const errorData = fromError(error);
  return errorData?.type === "file" && /^(File|Path) not found:/.test(errorData.message);
}

async function withUnsupportedOperationFallback<T>(
  adapterOperation: () => Promise<T>,
  localOperation: () => Promise<T>,
): Promise<T> {
  try {
    return await adapterOperation();
  } catch (error) {
    if (!isUnsupportedFileSystemOperation(error)) throw error;
    return await localOperation();
  }
}

export async function getEntityInfo(
  filePath: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  return await withSpan(
    "types.getEntityInfo",
    async () => {
      // Normalize path for Veryfront API adapter
      let normalizedPath = filePath;
      if (adapter) {
        const adapterFs = adapter.fs;
        if (isExtendedFSAdapter(adapterFs) && adapterFs.isVeryfrontAdapter()) {
          // API adapter needs relative paths, not absolute paths.
          // Match the first known entity directory to find where the project-relative path starts.
          // NOTE: "app" is intentionally excluded from the capture group because the container
          // project dir ("/app/") would be incorrectly matched as the "app" entity directory,
          // producing paths like "app/components/..." instead of "components/...".
          // The adapter's PathNormalizer handles stripping the absolute prefix correctly.
          normalizedPath = filePath.replace(
            /^.*?\/(pages|components|layouts)\//,
            "$1/",
          );
        }
      }

      try {
        const shouldReadDirectly = adapter
          ? isExtendedFSAdapter(adapter.fs) && adapter.fs.isVeryfrontAdapter()
          : false;

        let content: string;
        if (adapter) {
          if (!shouldReadDirectly) {
            const stat = await withUnsupportedOperationFallback(
              () => adapter.fs.stat(normalizedPath),
              () => fs.stat(filePath),
            );

            if (!stat.isFile) return null;
          }

          content = await withUnsupportedOperationFallback(
            () => adapter.fs.readFile(normalizedPath),
            () => fs.readTextFile(filePath),
          );
        } else {
          const stat = await fs.stat(filePath);
          if (!stat.isFile) return null;
          content = await fs.readTextFile(filePath);
        }

        const ext = pathHelper.extname(filePath).toLowerCase();

        let frontmatter: Frontmatter = {};
        let body = content;

        if (ext === ".md" || ext === ".mdx") {
          try {
            const extracted = extract(content);
            frontmatter = extracted.attrs as Frontmatter;
            body = extracted.body;
          } catch (_) {
            /* expected: malformed YAML frontmatter */
          }
        }

        const fileName = filePath.split("/").pop() ?? "";
        const { type, kind, isLayout, isComponent, isPage } = detectEntityType(
          fileName,
          frontmatter,
        );

        let entityId = filePath;
        if (adapter) {
          try {
            const adapterFs = adapter.fs;
            if (isExtendedFSAdapter(adapterFs) && adapterFs.isVeryfrontAdapter()) {
              const underlyingAdapter = adapterFs.getUnderlyingAdapter();

              if (
                underlyingAdapter &&
                "getEntityIdForPath" in underlyingAdapter &&
                typeof underlyingAdapter.getEntityIdForPath === "function"
              ) {
                const getEntityIdForPath = underlyingAdapter.getEntityIdForPath as (
                  path: string,
                ) => string | undefined;
                const relativePath = filePath
                  .replace(/^.*?\/pages\//, "pages/")
                  .replace(/^.*?\/components\//, "components/");
                entityId = getEntityIdForPath(relativePath) ?? entityId;
              }
            }
          } catch (_) {
            /* expected: entity ID extraction may fail, fall back to file path */
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
      } catch (error) {
        if (isFileNotFoundError(error)) return null;

        entityInfoScope.runSync(
          () => {
            throw error;
          },
          { path: filePath, details: { reason: "entity-info-failed" } },
          undefined,
        );
        throw error;
      }
    },
    { "entity.path": filePath },
  );
}

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
      const isVeryfrontRoute = normalizedSlug.startsWith(".veryfront/") ||
        normalizedSlug === ".veryfront";
      const resolveFile = adapter?.fs.resolveFile;

      logger.debug("START", {
        slug,
        normalizedSlug,
        projectDir,
        isVeryfrontRoute,
        hasResolveFile: !!resolveFile,
      });

      if (resolveFile) {
        const basePaths = [pathHelper.join(projectDir, pagesDirectory, normalizedSlug)];

        if (isVeryfrontRoute) basePaths.unshift(pathHelper.join(projectDir, normalizedSlug));
        if (normalizedSlug === "index" || normalizedSlug === "") {
          basePaths.unshift(pathHelper.join(projectDir, pagesDirectory, "index"));
        }

        logger.debug("Checking paths (resolveFile branch)", {
          slug,
          normalizedSlug,
          basePaths,
        });

        const candidateResults = await parallelMap(basePaths, async (basePath) => {
          const resolvedPath = await resolveFile.call(adapter.fs, basePath);
          logger.debug("resolveFile result", {
            basePath,
            resolvedPath,
          });
          if (!resolvedPath) return null;
          return await getEntityInfo(resolvedPath, adapter);
        });

        for (const info of candidateResults) {
          if (info?.entity.isPage) {
            logger.debug("Found page via resolveFile", {
              slug,
              normalizedSlug,
              path: info.entity.path,
            });
            return withResolvedSlug(info, normalizedSlug);
          }
        }

        const dynamicPage = await findDynamicPageEntity(
          projectDir,
          normalizedSlug,
          adapter,
          pagesDirectory,
        );
        if (dynamicPage) return withResolvedSlug(dynamicPage, normalizedSlug);

        logger.debug("No page found via resolveFile branch", { slug, normalizedSlug });
        return null;
      }

      const candidatePaths = [
        ...buildFileCandidates(
          projectDir,
          [pagesDirectory],
          normalizedSlug,
          PAGE_FILE_EXTENSIONS,
        ),
        ...buildFileCandidates(
          projectDir,
          [pagesDirectory],
          `${normalizedSlug}/index`,
          PAGE_FILE_EXTENSIONS,
        ),
      ];

      if (isVeryfrontRoute) {
        candidatePaths.unshift(
          ...buildFileCandidates(projectDir, [], normalizedSlug, DIRECT_ROUTE_EXTENSIONS),
        );
      }

      if (normalizedSlug === "index" || normalizedSlug === "") {
        candidatePaths.unshift(
          ...buildFileCandidates(
            projectDir,
            [pagesDirectory],
            "index",
            DIRECT_ROUTE_EXTENSIONS,
          ),
        );
      }

      const candidateResults = await parallelMap(candidatePaths, async (candidatePath) => {
        return await getEntityInfo(candidatePath, adapter);
      });

      for (const info of candidateResults) {
        if (info?.entity.isPage) return withResolvedSlug(info, normalizedSlug);
      }

      const dynamicPage = await findDynamicPageEntity(
        projectDir,
        normalizedSlug,
        adapter,
        pagesDirectory,
      );
      return dynamicPage ? withResolvedSlug(dynamicPage, normalizedSlug) : null;
    },
    {
      "entity.slug": slug,
      "entity.normalized_slug": normalizeSlug(slug),
      "entity.projectDir": projectDir,
    },
  );
}

export async function getLayoutEntity(
  projectDir: string,
  layoutName: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  return await withSpan(
    "types.getLayoutEntity",
    async () => {
      let resolvedLayoutName = layoutName;
      if (layoutName.startsWith("@components/")) {
        resolvedLayoutName = layoutName.replace("@components/", "components/");
      } else if (layoutName.startsWith("@/")) {
        resolvedLayoutName = layoutName.substring(2);
      }

      if (/\.(mdx|md|tsx|jsx|ts|js)$/.test(resolvedLayoutName)) {
        const directPath = pathHelper.join(projectDir, resolvedLayoutName);
        const info = await getEntityInfo(directPath, adapter);
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
      const componentCandidatePaths = [
        ...buildFileCandidates(
          projectDir,
          ["components"],
          `${resolvedLayoutName}Layout`,
          LAYOUT_FILE_EXTENSIONS,
        ),
        ...buildFileCandidates(projectDir, ["components"], "Layout", LAYOUT_FILE_EXTENSIONS),
      ];

      const candidateResults = await parallelMap(
        [...layoutCandidatePaths, ...componentCandidatePaths],
        async (candidatePath) => {
          return await getEntityInfo(candidatePath, adapter);
        },
      );

      const layoutCandidateCount = layoutCandidatePaths.length;
      for (let i = 0; i < candidateResults.length; i++) {
        const info = candidateResults[i];
        if (!info) continue;
        // layouts/ dir: any valid entity is a layout
        // components/ dir: must be detected as layout by name/frontmatter
        if (i < layoutCandidateCount || info.entity.isLayout) {
          return {
            entity: {
              ...info.entity,
              type: "layout",
              isLayout: true,
              isComponent: false,
              isPage: false,
            },
          };
        }
      }

      return null;
    },
    { "layout.name": layoutName, "layout.projectDir": projectDir },
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

async function findDynamicPageEntity(
  projectDir: string,
  normalizedSlug: string,
  adapter?: RuntimeAdapter,
  pagesDirectory = "pages",
): Promise<EntityInfo | null> {
  const slugParts = normalizedSlug === "" ? [] : normalizedSlug.split("/");
  const candidates: Array<{ path: string; pattern: string; specificity: number }> = [];

  // Begin at the slug's own directory so an optional catch-all can match zero
  // remaining segments, e.g. `/optional` resolving
  // `pages/optional/[[...slug]].tsx`. Canonical route matching below rejects
  // non-optional patterns that do not actually match the slug.
  for (let depth = slugParts.length; depth >= 0; depth--) {
    const parentPath = slugParts.slice(0, depth).join("/");
    const pagesDir = parentPath
      ? pathHelper.join(projectDir, pagesDirectory, parentPath)
      : pathHelper.join(projectDir, pagesDirectory);

    const canReadDirectory = await pagesDirectoryExists(pagesDir, adapter);
    if (!canReadDirectory) continue;

    try {
      const entries = await readDirectoryEntries(pagesDir, adapter);
      const dynamicEntries = entries.filter(
        (entry) => entry.isFile && DYNAMIC_PAGE_ENTRY_PATTERN.test(entry.name),
      );

      for (const entry of dynamicEntries) {
        const candidatePath = pathHelper.join(pagesDir, entry.name);
        const routeStem = entry.name.replace(/\.(mdx|md|tsx|jsx|ts|js)$/, "");
        const routePattern = parentPath ? `${parentPath}/${routeStem}` : routeStem;
        const route = parseRoute(routePattern, candidatePath);
        if (!matchRoute(normalizedSlug, route)) continue;

        candidates.push({
          path: candidatePath,
          pattern: routePattern,
          specificity: getSpecificityScore(route),
        });
      }
    } catch (error) {
      if (isFileNotFoundError(error)) continue;
      throw error;
    }
  }

  if (candidates.length === 0) return null;

  const bestSpecificity = candidates.reduce(
    (highest, candidate) => Math.max(highest, candidate.specificity),
    Number.NEGATIVE_INFINITY,
  );
  const bestCandidates = candidates.filter(
    (candidate) => candidate.specificity === bestSpecificity,
  );

  if (bestCandidates.length !== 1) {
    logger.warn("Ambiguous dynamic page routes", {
      slug: normalizedSlug,
      candidates: bestCandidates.map((candidate) => candidate.pattern).sort(),
    });
    return null;
  }

  const winner = bestCandidates[0];
  if (!winner) return null;

  const info = await getEntityInfo(winner.path, adapter);
  return info?.entity.isPage ? info : null;
}

function withResolvedSlug(info: EntityInfo, normalizedSlug: string): EntityInfo {
  return {
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
  try {
    const stat = adapter
      ? await withUnsupportedOperationFallback(
        () => adapter.fs.stat(pagesDir),
        () => fs.stat(pagesDir),
      )
      : await fs.stat(pagesDir);
    return stat.isDirectory;
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

async function readDirectoryEntries(
  pagesDir: string,
  adapter?: RuntimeAdapter,
): Promise<DirectoryEntry[]> {
  const collectEntries = async (iterator: AsyncIterable<DirectoryEntry>) => {
    const entries: DirectoryEntry[] = [];
    for await (const entry of iterator) entries.push(entry);
    return entries;
  };

  if (!adapter) return await collectEntries(fs.readDir(pagesDir));

  try {
    return await collectEntries(adapter.fs.readDir(pagesDir));
  } catch (error) {
    if (!isUnsupportedFileSystemOperation(error)) throw error;
    return await collectEntries(fs.readDir(pagesDir));
  }
}

function getSlugFromPath(filePath: string): string {
  const parts = filePath.split(pathHelper.sep);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?)$/, "");
  if (slug !== "index") return slug;

  const parentDir = parts[parts.length - 2];
  return parentDir === "pages" ? "" : parentDir ?? "";
}

function normalizeSlug(slug: string): string {
  return slug === "/" ? "" : slug.replace(/^\/+/, "").replace(/\/+$/, "");
}
