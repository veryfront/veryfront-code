import { extract } from "#std/front-matter/yaml.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { detectEntityType } from "../entities.ts";
import { createError, createErrorScope, toError } from "#veryfront/errors";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withFallback } from "#veryfront/platform/adapters/fallback-wrapper.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("get-entity-by-slug");

const entityInfoScope = createErrorScope("getEntityInfo");
const fs = createFileSystem();
const PAGE_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const DIRECT_ROUTE_EXTENSIONS = PAGE_FILE_EXTENSIONS;
const LAYOUT_FILE_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"] as const;
const DYNAMIC_PAGE_ENTRY_PATTERN = /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/;

type DirectoryEntry = { name: string; isFile: boolean; isDirectory: boolean };

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
            try {
              const stat = await withFallback(
                () => adapter.fs.stat(normalizedPath),
                async () => {
                  const exists = await fs.exists(filePath);
                  if (!exists) {
                    throw toError(
                      createError({
                        type: "file",
                        message: "File not found",
                        context: { path: filePath, operation: "read" },
                      }),
                    );
                  }
                  return await fs.stat(filePath);
                },
                { operationName: "stat:getEntityInfo", logError: false },
              );

              if (!stat.isFile) return null;
            } catch (error) {
              entityInfoScope.runSync(
                () => {
                  throw error;
                },
                { path: filePath, details: { reason: "stat-failed" } },
                undefined,
              );
              return null;
            }
          }

          content = await withFallback(
            () => adapter.fs.readFile(normalizedPath),
            () => fs.readTextFile(filePath),
            { operationName: "readFile:getEntityInfo", logError: false },
          );
        } else {
          const exists = await fs.exists(filePath);
          if (!exists) return null;
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
        entityInfoScope.runSync(
          () => {
            throw error;
          },
          { path: filePath, details: { reason: "entity-info-failed" } },
          undefined,
        );
        return null;
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
  for (let depth = slugParts.length - 1; depth >= 0; depth--) {
    const parentPath = slugParts.slice(0, depth).join("/");
    const pagesDir = parentPath
      ? pathHelper.join(projectDir, pagesDirectory, parentPath)
      : pathHelper.join(projectDir, pagesDirectory);

    try {
      const canReadDirectory = await pagesDirectoryExists(pagesDir, adapter);
      if (!canReadDirectory) continue;

      const entries = await readDirectoryEntries(pagesDir, adapter);
      const dynamicEntries = entries.filter(
        (entry) => entry.isFile && DYNAMIC_PAGE_ENTRY_PATTERN.test(entry.name),
      );

      const candidateResults = await parallelMap(dynamicEntries, async (entry) => {
        const candidatePath = pathHelper.join(pagesDir, entry.name);
        return await getEntityInfo(candidatePath, adapter);
      });

      for (const info of candidateResults) {
        if (info?.entity.isPage) return info;
      }
    } catch (_) {
      /* expected: directory may not exist or readDir may fail */
    }
  }

  return null;
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
  if (!adapter) return await fs.exists(pagesDir);

  try {
    const stat = await withFallback(
      () => adapter.fs.stat(pagesDir),
      () => fs.stat(pagesDir),
      { operationName: "stat:getEntityBySlug", logError: false },
    );
    return stat.isDirectory;
  } catch (_) {
    /* expected: stat may fail for non-existent directories */
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
    entries.push(entry);
  }

  return entries;
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
