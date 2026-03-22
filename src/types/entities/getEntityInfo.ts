import { extract } from "#std/front-matter/yaml.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/compat/path";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { detectEntityType } from "../entities.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createErrorScope } from "#veryfront/errors/error-context.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withFallback } from "#veryfront/platform/adapters/fallback-wrapper.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("get-entity-by-slug");

const entityInfoScope = createErrorScope("getEntityInfo");
const fs = createFileSystem();

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
): Promise<EntityInfo | null> {
  return await withSpan(
    "types.getEntityBySlug",
    async () => {
      const normalizedSlug = slug === "/" ? "" : slug.replace(/^\/+/, "").replace(/\/+$/, "");
      const isVeryfrontRoute = normalizedSlug.startsWith(".veryfront/") || normalizedSlug === ".veryfront";
      const resolveFile = adapter?.fs.resolveFile;

      logger.debug("START", {
        slug,
        normalizedSlug,
        projectDir,
        isVeryfrontRoute,
        hasResolveFile: !!resolveFile,
      });

      if (resolveFile) {
        const basePaths = [pathHelper.join(projectDir, "pages", normalizedSlug)];

        if (isVeryfrontRoute) basePaths.unshift(pathHelper.join(projectDir, normalizedSlug));
        if (normalizedSlug === "index" || normalizedSlug === "") {
          basePaths.unshift(pathHelper.join(projectDir, "pages", "index"));
        }

        logger.debug("Checking paths (resolveFile branch)", {
          slug,
          normalizedSlug,
          basePaths,
        });

        const pathResults = await parallelMap(basePaths, async (basePath) => {
          const resolvedPath = await resolveFile.call(adapter.fs, basePath);
          logger.debug("resolveFile result", {
            basePath,
            resolvedPath,
          });
          if (!resolvedPath) return null;
          return await getEntityInfo(resolvedPath, adapter);
        });

        for (const info of pathResults) {
          if (info?.entity.isPage) {
            logger.debug("Found page via resolveFile", {
              slug,
              normalizedSlug,
              path: info.entity.path,
            });
            return info;
          }
        }

        const slugParts = normalizedSlug === "" ? [] : normalizedSlug.split("/");
        for (let depth = slugParts.length - 1; depth >= 0; depth--) {
          const parentPath = slugParts.slice(0, depth).join("/");
          const pagesDir = parentPath
            ? pathHelper.join(projectDir, "pages", parentPath)
            : pathHelper.join(projectDir, "pages");

          try {
            let dirExists = false;
            try {
              const stat = await withFallback(
                () => adapter.fs.stat(pagesDir),
                () => fs.stat(pagesDir),
                { operationName: "stat:getEntityBySlug", logError: false },
              );
              dirExists = stat.isDirectory;
            } catch (_) {
              /* expected: stat may fail for non-existent directories */
              dirExists = false;
            }

            if (!dirExists) continue;

            const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
            for await (const entry of adapter.fs.readDir(pagesDir)) {
              entries.push(entry);
            }

            const dynamicEntries = entries.filter(
              (entry) => entry.isFile && /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/.test(entry.name),
            );

            const dynamicResults = await parallelMap(dynamicEntries, async (entry) => {
              const dynamicPath = pathHelper.join(pagesDir, entry.name);
              return await getEntityInfo(dynamicPath, adapter);
            });

            for (const info of dynamicResults) {
              if (info?.entity.isPage) return info;
            }
          } catch (_) {
            /* expected: directory may not exist or readDir may fail */
          }
        }

        logger.debug("No page found via resolveFile branch", { slug, normalizedSlug });
        return null;
      }

      const possiblePaths = [
        pathHelper.join(projectDir, "pages", `${normalizedSlug}.mdx`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}.md`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}.tsx`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}.jsx`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}.ts`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}/index.mdx`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}/index.md`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}/index.tsx`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}/index.jsx`),
        pathHelper.join(projectDir, "pages", `${normalizedSlug}/index.ts`),
      ];

      if (isVeryfrontRoute) {
        possiblePaths.unshift(
          pathHelper.join(projectDir, `${normalizedSlug}.mdx`),
          pathHelper.join(projectDir, `${normalizedSlug}.md`),
          pathHelper.join(projectDir, `${normalizedSlug}.tsx`),
          pathHelper.join(projectDir, `${normalizedSlug}.ts`),
        );
      }

      if (normalizedSlug === "index" || normalizedSlug === "") {
        possiblePaths.unshift(
          pathHelper.join(projectDir, "pages", "index.mdx"),
          pathHelper.join(projectDir, "pages", "index.md"),
          pathHelper.join(projectDir, "pages", "index.tsx"),
          pathHelper.join(projectDir, "pages", "index.ts"),
        );
      }

      const pathResults = await parallelMap(possiblePaths, async (p) => {
        return await getEntityInfo(p, adapter);
      });

      for (const info of pathResults) {
        if (info?.entity.isPage) return info;
      }

      const slugParts = normalizedSlug === "" ? [] : normalizedSlug.split("/");
      for (let depth = slugParts.length - 1; depth >= 0; depth--) {
        const parentPath = slugParts.slice(0, depth).join("/");
        const pagesDir = parentPath
          ? pathHelper.join(projectDir, "pages", parentPath)
          : pathHelper.join(projectDir, "pages");

        try {
          let dirExists = false;
          if (adapter) {
            try {
              const stat = await withFallback(
                () => adapter.fs.stat(pagesDir),
                () => fs.stat(pagesDir),
                { operationName: "stat:getEntityBySlug", logError: false },
              );
              dirExists = stat.isDirectory;
            } catch (_) {
              /* expected: stat may fail for non-existent directories */
              dirExists = false;
            }
          } else {
            dirExists = await fs.exists(pagesDir);
          }

          if (!dirExists) continue;

          const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
          const dirIterator = adapter?.fs.readDir
            ? adapter.fs.readDir(pagesDir)
            : fs.readDir(pagesDir);
          for await (const entry of dirIterator) {
            entries.push(entry);
          }

          const dynamicEntries = entries.filter(
            (entry) => entry.isFile && /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/.test(entry.name),
          );

          const dynamicResults = await parallelMap(dynamicEntries, async (entry) => {
            const dynamicPath = pathHelper.join(pagesDir, entry.name);
            return await getEntityInfo(dynamicPath, adapter);
          });

          for (const info of dynamicResults) {
            if (info?.entity.isPage) return info;
          }
        } catch (_) {
          /* expected: directory may not exist or readDir may fail */
        }
      }

      return null;
    },
    { "entity.slug": slug, "entity.normalized_slug": slug === "/" ? "" : slug.replace(/^\/+/, "").replace(/\/+$/, ""), "entity.projectDir": projectDir },
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
      const layoutsDirPaths = [
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.mdx`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.md`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.tsx`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.jsx`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.ts`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.js`),
      ];

      // Files in components/ must be detected as layouts by name/frontmatter
      const componentsPaths = [
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.mdx`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.md`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.tsx`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.jsx`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.ts`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.js`),
        pathHelper.join(projectDir, "components", "Layout.mdx"),
        pathHelper.join(projectDir, "components", "Layout.md"),
        pathHelper.join(projectDir, "components", "Layout.tsx"),
        pathHelper.join(projectDir, "components", "Layout.jsx"),
        pathHelper.join(projectDir, "components", "Layout.ts"),
        pathHelper.join(projectDir, "components", "Layout.js"),
      ];

      const allPaths = [...layoutsDirPaths, ...componentsPaths];
      const pathResults = await parallelMap(allPaths, async (p) => {
        return await getEntityInfo(p, adapter);
      });

      const layoutsDirCount = layoutsDirPaths.length;
      for (let i = 0; i < pathResults.length; i++) {
        const info = pathResults[i];
        if (!info) continue;
        // layouts/ dir: any valid entity is a layout
        // components/ dir: must be detected as layout by name/frontmatter
        if (i < layoutsDirCount || info.entity.isLayout) {
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

function getSlugFromPath(filePath: string): string {
  const parts = filePath.split(pathHelper.sep);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?)$/, "");
  if (slug !== "index") return slug;

  const parentDir = parts[parts.length - 2];
  return parentDir === "pages" ? "" : parentDir ?? "";
}
