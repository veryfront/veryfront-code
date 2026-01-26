import { extract } from "../../platform/compat/std/front-matter-yaml.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import * as pathHelper from "../../platform/compat/path-helper.js";
import { isExtendedFSAdapter } from "../../platform/adapters/fs/wrapper.js";
import { detectEntityType } from "../entities.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { createErrorScope } from "../../errors/error-context.js";
import type { Entity, EntityInfo, Frontmatter } from "../entities.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { withFallback } from "../../platform/adapters/fallback-wrapper.js";
import { parallelMap } from "../../utils/parallel.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { logger } from "../../utils/index.js";

const entityInfoScope = createErrorScope("getEntityInfo");
const fs = createFileSystem();

export async function getEntityInfo(
  filePath: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  return await withSpan(
    "types.getEntityInfo",
    async () => {
      try {
        if (adapter) {
          try {
            const stat = await withFallback(
              () => adapter.fs.stat(filePath),
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
        } else {
          const exists = await fs.exists(filePath);
          if (!exists) return null;
        }

        const content = adapter
          ? await withFallback(
            () => adapter.fs.readFile(filePath),
            () => fs.readTextFile(filePath),
            { operationName: "readFile:getEntityInfo", logError: false },
          )
          : await fs.readTextFile(filePath);

        const ext = pathHelper.extname(filePath).toLowerCase();

        let frontmatter: Frontmatter = {};
        let body = content;

        if (ext === ".md" || ext === ".mdx") {
          try {
            const extracted = extract(content);
            frontmatter = extracted.attrs as Frontmatter;
            body = extracted.body;
          } catch {
            // Malformed YAML frontmatter - continue with empty frontmatter
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
              const underlyingAdapter = adapterFs.getUnderlyingAdapter() as {
                getEntityIdForPath?: (path: string) => string | undefined;
              };

              const getEntityIdForPath = underlyingAdapter?.getEntityIdForPath;
              if (getEntityIdForPath) {
                const relativePath = filePath
                  .replace(/^.*?\/pages\//, "pages/")
                  .replace(/^.*?\/components\//, "components/");
                entityId = getEntityIdForPath(relativePath) ?? entityId;
              }
            }
          } catch {
            // Ignore errors, fall back to file path
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
      const isVeryfrontRoute = slug.startsWith(".veryfront/") || slug === ".veryfront";
      const resolveFile = adapter?.fs.resolveFile;

      logger.debug("[getEntityBySlug] START", {
        slug,
        projectDir,
        isVeryfrontRoute,
        hasResolveFile: !!resolveFile,
      });

      if (resolveFile) {
        // Only check pages/ directory for routes (root files are not routable)
        const basePaths = [pathHelper.join(projectDir, "pages", slug)];

        // .veryfront routes can be at root level
        if (isVeryfrontRoute) {
          basePaths.unshift(pathHelper.join(projectDir, slug));
        }

        if (slug === "index" || slug === "") {
          basePaths.unshift(pathHelper.join(projectDir, "pages", "index"));
        }

        logger.debug("[getEntityBySlug] Checking paths (resolveFile branch)", {
          slug,
          basePaths,
        });

        const pathResults = await parallelMap(basePaths, async (basePath) => {
          const resolvedPath = await resolveFile.call(adapter.fs, basePath);
          logger.debug("[getEntityBySlug] resolveFile result", {
            basePath,
            resolvedPath,
          });
          if (!resolvedPath) return null;
          return await getEntityInfo(resolvedPath, adapter);
        });

        for (const info of pathResults) {
          if (info?.entity.isPage) {
            logger.debug("[getEntityBySlug] Found page via resolveFile", {
              slug,
              path: info.entity.path,
            });
            return info;
          }
        }

        const slugParts = slug.split("/");
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
            } catch {
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
          } catch {
            // Directory doesn't exist or error reading it, continue to next depth
          }
        }

        logger.debug("[getEntityBySlug] No page found via resolveFile branch", { slug });
        return null;
      }

      // Only check pages/ directory for routes (root files are not routable)
      const possiblePaths = [
        pathHelper.join(projectDir, "pages", `${slug}.mdx`),
        pathHelper.join(projectDir, "pages", `${slug}.md`),
        pathHelper.join(projectDir, "pages", `${slug}.tsx`),
        pathHelper.join(projectDir, "pages", `${slug}.jsx`),
        pathHelper.join(projectDir, "pages", `${slug}.ts`),
        pathHelper.join(projectDir, "pages", `${slug}/index.mdx`),
        pathHelper.join(projectDir, "pages", `${slug}/index.md`),
        pathHelper.join(projectDir, "pages", `${slug}/index.tsx`),
        pathHelper.join(projectDir, "pages", `${slug}/index.jsx`),
        pathHelper.join(projectDir, "pages", `${slug}/index.ts`),
      ];

      // .veryfront routes can be at root level
      if (isVeryfrontRoute) {
        possiblePaths.unshift(
          pathHelper.join(projectDir, `${slug}.mdx`),
          pathHelper.join(projectDir, `${slug}.md`),
          pathHelper.join(projectDir, `${slug}.tsx`),
          pathHelper.join(projectDir, `${slug}.ts`),
        );
      }

      if (slug === "index" || slug === "") {
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

      const slugParts = slug.split("/");
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
            } catch {
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
        } catch {
          // Directory doesn't exist or error reading it, continue to next depth
        }
      }

      return null;
    },
    { "entity.slug": slug, "entity.projectDir": projectDir },
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
      }

      const possiblePaths = [
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.mdx`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.md`),
        pathHelper.join(projectDir, "layouts", `${resolvedLayoutName}.tsx`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.mdx`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.md`),
        pathHelper.join(projectDir, "components", `${resolvedLayoutName}Layout.tsx`),
        pathHelper.join(projectDir, "components", "Layout.mdx"),
        pathHelper.join(projectDir, "components", "Layout.md"),
        pathHelper.join(projectDir, "components", "Layout.tsx"),
      ];

      const pathResults = await parallelMap(possiblePaths, async (p) => {
        return await getEntityInfo(p, adapter);
      });

      for (const info of pathResults) {
        if (info?.entity.isLayout) return info;
      }

      return null;
    },
    { "layout.name": layoutName, "layout.projectDir": projectDir },
  );
}

function getSlugFromPath(filePath: string): string {
  const parts = filePath.split(pathHelper.sep);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?|ts)$/, "");
  if (slug !== "index") return slug;

  const parentDir = parts[parts.length - 2];
  return parentDir === "pages" ? "" : parentDir ?? "";
}
