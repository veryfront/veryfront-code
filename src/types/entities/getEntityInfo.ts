import { extract } from "#std/front-matter/yaml.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/platform/compat/path-helper.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { detectEntityType } from "../entities.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createErrorScope } from "#veryfront/errors/error-context.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
// Import directly from source to avoid circular dependency through barrel
import { withFallback } from "#veryfront/platform/adapters/fallback-wrapper.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const entityInfoScope = createErrorScope("getEntityInfo");

const fs = createFileSystem();

export async function getEntityInfo(
  filePath: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  return await withSpan("types.getEntityInfo", async () => {
    try {
      // Check file existence using adapter with fallback to local filesystem
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
      } else if (!(await fs.exists(filePath))) {
        return null;
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

      if ([".md", ".mdx"].includes(ext)) {
        try {
          const extracted = extract(content);
          frontmatter = extracted.attrs as Frontmatter;
          body = extracted.body;
        } catch {
          // Malformed YAML frontmatter - continue with empty frontmatter
          // This is expected for files with invalid/incomplete frontmatter syntax
        }
      }

      const fileName = filePath.split("/").pop() || "";
      const { type, kind, isLayout, isComponent, isPage } = detectEntityType(
        fileName,
        frontmatter,
      );

      // Try to get entity UUID from the FS adapter if available
      // This is used when rendering in Studio iframe to send correct page ID
      let entityId = filePath; // Default to file path
      if (adapter) {
        try {
          const fs = adapter.fs;
          if (isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter()) {
            const underlyingAdapter = fs.getUnderlyingAdapter() as {
              getEntityIdForPath?: (path: string) => string | undefined;
            };
            if (underlyingAdapter?.getEntityIdForPath) {
              // Get relative path for lookup - convert absolute path to project-relative path
              const relativePath = filePath.replace(/^.*?\/pages\//, "pages/").replace(
                /^.*?\/components\//,
                "components/",
              );
              const apiEntityId = underlyingAdapter.getEntityIdForPath(relativePath);
              if (apiEntityId) {
                entityId = apiEntityId;
              }
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
  }, { "entity.path": filePath });
}

export async function getEntityBySlug(
  projectDir: string,
  slug: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  return await withSpan("types.getEntityBySlug", async () => {
    // Handle .veryfront routes - strip the leading .veryfront from slug for path resolution
    const isVeryfrontRoute = slug.startsWith(".veryfront/") || slug === ".veryfront";

    // If adapter has resolveFile, use pattern-based resolution
    const resolveFile = adapter?.fs.resolveFile;
    if (resolveFile) {
      const basePaths = [
        pathHelper.join(projectDir, "pages", slug),
        pathHelper.join(projectDir, slug),
      ];

      // Add .veryfront paths for .veryfront routes
      if (isVeryfrontRoute) {
        basePaths.unshift(pathHelper.join(projectDir, slug));
      }

      if (slug === "index" || slug === "") {
        basePaths.unshift(
          pathHelper.join(projectDir, "pages", "index"),
          pathHelper.join(projectDir, "index"),
        );
      }

      // Resolve all base paths in parallel and cache EntityInfo results
      // This avoids duplicate fetches - we resolve once and reuse the cached result
      const pathResults = await parallelMap(basePaths, async (basePath) => {
        const resolvedPath = await resolveFile.call(adapter.fs, basePath);
        if (resolvedPath) {
          const info = await getEntityInfo(resolvedPath, adapter);
          return { basePath, info };
        }
        return { basePath, info: null };
      });

      // Find first match by priority order (basePaths array order)
      for (const { info } of pathResults) {
        if (info?.entity.isPage) {
          return info;
        }
      }

      // Try dynamic routes
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

          if (dirExists) {
            const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
            const dirIterator = adapter.fs.readDir(pagesDir);
            for await (const entry of dirIterator) {
              entries.push(entry);
            }

            // Filter to dynamic route files and resolve in parallel
            const dynamicEntries = entries.filter(
              (entry) => entry.isFile && /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/.test(entry.name),
            );
            const dynamicResults = await parallelMap(dynamicEntries, async (entry) => {
              const dynamicPath = pathHelper.join(pagesDir, entry.name);
              const info = await getEntityInfo(dynamicPath, adapter);
              return info;
            });
            // Return first page match
            for (const info of dynamicResults) {
              if (info?.entity.isPage) {
                return info;
              }
            }
          }
        } catch {
          // Directory doesn't exist or error reading it, continue to next depth
        }
      }

      return null;
    }

    // Fallback for adapters without resolveFile
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
      pathHelper.join(projectDir, `${slug}.mdx`),
      pathHelper.join(projectDir, `${slug}.md`),
      pathHelper.join(projectDir, `${slug}.tsx`),
      pathHelper.join(projectDir, `${slug}.ts`),
    ];

    // For .veryfront routes, add the direct path at the start
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
        pathHelper.join(projectDir, "index.mdx"),
        pathHelper.join(projectDir, "index.md"),
        pathHelper.join(projectDir, "index.tsx"),
        pathHelper.join(projectDir, "index.ts"),
      );
    }

    // Resolve all possible paths in parallel and cache results
    const pathResults = await parallelMap(possiblePaths, async (p) => {
      const info = await getEntityInfo(p, adapter);
      return info;
    });

    // Return first page match by priority order
    for (const info of pathResults) {
      if (info?.entity.isPage) {
        return info;
      }
    }

    // If no exact match found, try dynamic routes with [param] notation
    // e.g., slug "blog/my-post" should match "pages/blog/[slug].tsx"
    const slugParts = slug.split("/");

    // Try to match dynamic routes for all path depths
    for (let depth = slugParts.length - 1; depth >= 0; depth--) {
      const parentPath = slugParts.slice(0, depth).join("/");
      const pagesDir = parentPath
        ? pathHelper.join(projectDir, "pages", parentPath)
        : pathHelper.join(projectDir, "pages");

      try {
        // Check if directory exists
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

        if (dirExists) {
          const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
          // Use adapter's readDir if available, otherwise fall back to local fs
          const dirIterator = adapter?.fs.readDir
            ? adapter.fs.readDir(pagesDir)
            : fs.readDir(pagesDir);
          for await (const entry of dirIterator) {
            entries.push(entry);
          }

          // Filter to dynamic route files and resolve in parallel
          const dynamicEntries = entries.filter(
            (entry) => entry.isFile && /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/.test(entry.name),
          );
          const dynamicResults = await parallelMap(dynamicEntries, async (entry) => {
            const dynamicPath = pathHelper.join(pagesDir, entry.name);
            const info = await getEntityInfo(dynamicPath, adapter);
            return info;
          });
          // Return first page match
          for (const info of dynamicResults) {
            if (info?.entity.isPage) {
              return info;
            }
          }
        }
      } catch {
        // Directory doesn't exist or error reading it, continue to next depth
      }
    }

    return null;
  }, { "entity.slug": slug, "entity.projectDir": projectDir });
}

export async function getLayoutEntity(
  projectDir: string,
  layoutName: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  return await withSpan("types.getLayoutEntity", async () => {
    // Handle path aliases like @components/ and @/
    let resolvedLayoutName = layoutName;
    if (layoutName.startsWith("@components/")) {
      // @components/ maps to components/ directory
      resolvedLayoutName = layoutName.replace("@components/", "components/");
    } else if (layoutName.startsWith("@/")) {
      // @/ maps to project root
      resolvedLayoutName = layoutName.substring(2);
    }

    // If it's a full path with extension, try it directly
    if (/\.(mdx|md|tsx|jsx|ts|js)$/.test(resolvedLayoutName)) {
      const directPath = pathHelper.join(projectDir, resolvedLayoutName);
      const info = await getEntityInfo(directPath, adapter);
      if (info?.entity.isLayout) return info;
    }

    // Otherwise, try standard layout name resolution
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

    // Resolve all paths in parallel and cache results
    const pathResults = await parallelMap(possiblePaths, async (p) => {
      const info = await getEntityInfo(p, adapter);
      return info;
    });

    // Return first layout match
    for (const info of pathResults) {
      if (info?.entity.isLayout) {
        return info;
      }
    }
    return null;
  }, { "layout.name": layoutName, "layout.projectDir": projectDir });
}

function getSlugFromPath(filePath: string): string {
  const parts = filePath.split(pathHelper.sep);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?|ts)$/, "");
  if (slug !== "index") return slug;

  const parentDir = parts[parts.length - 2];
  return parentDir === "pages" ? "" : parentDir ?? "";
}
