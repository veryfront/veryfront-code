// Conditional imports for front_matter (path is handled via path-helper)
let extractYaml: ((content: string) => any) | undefined;
let jsYamlModule: typeof import("js-yaml") | null = null;
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import * as pathHelper from "@veryfront/platform/compat/path-helper.ts";
import { isExtendedFSAdapter } from "@veryfront/platform/adapters/fs/wrapper.ts";

// Initialize extractYaml based on runtime
// @ts-ignore - Deno global
if (typeof Deno === "undefined") {
  // Node.js environment - use lazy loading for js-yaml
  extractYaml = (content: string) => {
    const frontMatterRegex = /^---\n([\s\S]*?)\n---/; // Basic regex for YAML front matter
    const match = content.match(frontMatterRegex);
    if (match && match[1]) {
      // Synchronous parsing with cached module
      if (jsYamlModule) {
        const attrs = jsYamlModule.load(match[1]);
        const body = content.slice(match[0].length);
        return { attrs, body };
      }
      // Fallback: return content without parsing if module not loaded
      return { attrs: {}, body: content };
    }
    return { attrs: {}, body: content };
  };

  // Eagerly load js-yaml module
  import("js-yaml").then((mod) => {
    jsYamlModule = mod;
  }).catch((e) => {
    console.warn("Could not import js-yaml for Node.js frontmatter parsing.", e);
  });
} else {
  // @ts-ignore - Deno global
  const { extract } = await import("std/front_matter/yaml.ts");
  extractYaml = extract;
}

import { detectEntityType } from "../entities.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { createErrorScope } from "@veryfront/errors/error-context.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
// Import directly from source to avoid circular dependency through barrel
import { withFallback } from "@veryfront/platform/adapters/fallback-wrapper.ts";
import { parallelFind, parallelMap } from "@veryfront/utils/parallel.ts";

const entityInfoScope = createErrorScope("getEntityInfo");

const fs = createFileSystem();

export async function getEntityInfo(
  filePath: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
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

    if ([".md", ".mdx"].includes(ext) && extractYaml) {
      try {
        const extracted = extractYaml(content);
        frontmatter = extracted.attrs as Frontmatter;
        body = extracted.body;
      } catch {
        // Malformed YAML frontmatter - continue with empty frontmatter
        // This is expected for files with invalid/incomplete frontmatter syntax
      }
    }

    const fileName = filePath.split("/").pop() || "";
    const { type, kind, isLayout, isProvider, isComponent, isPage } = detectEntityType(
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
      isProvider,
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
}

export async function getEntityBySlug(
  projectDir: string,
  slug: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
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

    // Check all base paths in parallel, return first match by priority order
    const resolvedBasePath = await parallelFind(basePaths, async (basePath) => {
      const resolvedPath = await resolveFile.call(adapter.fs, basePath);
      if (resolvedPath) {
        const info = await getEntityInfo(resolvedPath, adapter);
        return info?.entity.isPage ?? false;
      }
      return false;
    });

    if (resolvedBasePath) {
      const resolvedPath = await resolveFile.call(adapter.fs, resolvedBasePath);
      if (resolvedPath) {
        return await getEntityInfo(resolvedPath, adapter);
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

          // Filter to dynamic route files and check in parallel
          const dynamicEntries = entries.filter(
            (entry) => entry.isFile && /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/.test(entry.name),
          );
          const matchedEntry = await parallelFind(dynamicEntries, async (entry) => {
            const dynamicPath = pathHelper.join(pagesDir, entry.name);
            const info = await getEntityInfo(dynamicPath, adapter);
            return info?.entity.isPage ?? false;
          });
          if (matchedEntry) {
            const dynamicPath = pathHelper.join(pagesDir, matchedEntry.name);
            return await getEntityInfo(dynamicPath, adapter);
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

  // Check all possible paths in parallel, return first match by priority order
  const matchedPath = await parallelFind(possiblePaths, async (p) => {
    const info = await getEntityInfo(p, adapter);
    return info?.entity.isPage ?? false;
  });

  if (matchedPath) {
    return await getEntityInfo(matchedPath, adapter);
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

        // Filter to dynamic route files and check in parallel
        const dynamicEntries = entries.filter(
          (entry) => entry.isFile && /\[.+\]\.(mdx|md|tsx|jsx|ts|js)$/.test(entry.name),
        );
        const matchedEntry = await parallelFind(dynamicEntries, async (entry) => {
          const dynamicPath = pathHelper.join(pagesDir, entry.name);
          const info = await getEntityInfo(dynamicPath, adapter);
          return info?.entity.isPage ?? false;
        });
        if (matchedEntry) {
          const dynamicPath = pathHelper.join(pagesDir, matchedEntry.name);
          return await getEntityInfo(dynamicPath, adapter);
        }
      }
    } catch {
      // Directory doesn't exist or error reading it, continue to next depth
    }
  }

  return null;
}

export async function getLayoutEntity(
  projectDir: string,
  layoutName: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
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

  // Check all paths in parallel and return first matching layout
  const result = await parallelFind(possiblePaths, async (p) => {
    const info = await getEntityInfo(p, adapter);
    return info?.entity.isLayout ?? false;
  });

  if (result) {
    return await getEntityInfo(result, adapter);
  }
  return null;
}

export async function getProviderEntities(
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo[]> {
  const providerDirs = [
    pathHelper.join(projectDir, "providers"),
    pathHelper.join(projectDir, "components"),
  ];

  // Check directory existence in parallel
  const dirChecks = await parallelMap(providerDirs, async (dir) => {
    let dirExists = false;
    if (adapter) {
      try {
        const stat = await withFallback(
          () => adapter.fs.stat(dir),
          () => fs.stat(dir),
          { operationName: "stat:getProviderEntities", logError: false },
        );
        dirExists = stat.isDirectory;
      } catch {
        dirExists = false;
      }
    } else {
      dirExists = await fs.exists(dir);
    }
    return { dir, dirExists };
  });

  // Collect all file entries from existing directories
  const allFilePaths: string[] = [];
  for (const { dir, dirExists } of dirChecks) {
    if (dirExists) {
      const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
      const dirIterator = adapter?.fs.readDir ? adapter.fs.readDir(dir) : fs.readDir(dir);
      for await (const entry of dirIterator) {
        entries.push(entry);
      }
      for (const entry of entries) {
        if (entry.isFile) {
          allFilePaths.push(pathHelper.join(dir, entry.name));
        }
      }
    }
  }

  // Process all files in parallel to check if they are providers
  const entityInfos = await parallelMap(allFilePaths, async (filePath) => {
    const info = await getEntityInfo(filePath, adapter);
    return info?.entity.isProvider ? info : null;
  });

  // Filter out nulls and sort by priority
  const providers = entityInfos.filter((info): info is EntityInfo => info !== null);
  const getPriority = (e: EntityInfo): number =>
    typeof e.entity.frontmatter.priority === "number" ? e.entity.frontmatter.priority : 0;
  return providers.sort((a, b) => getPriority(a) - getPriority(b));
}

function getSlugFromPath(filePath: string): string {
  const parts = filePath.split(pathHelper.sep);
  const fileName = parts[parts.length - 1] ?? "";
  const slug = fileName.replace(/\.(mdx?|tsx?|jsx?|ts)$/, "");
  if (slug !== "index") return slug;

  const parentDir = parts[parts.length - 2];
  return parentDir === "pages" ? "" : parentDir ?? "";
}
