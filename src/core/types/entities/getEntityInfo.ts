// Conditional imports for front_matter (path is handled via path-helper)
let extractYaml: ((content: string) => any) | undefined;
let jsYamlModule: typeof import("js-yaml") | null = null;
import { createFileSystem } from "../../../platform/compat/fs.ts";
import * as pathHelper from "../../../platform/compat/path-helper.ts";

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
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { withFallback } from "@veryfront/platform/adapters/index.ts";

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
      } catch {
        return null;
      }
    } else {
      if (!(await fs.exists(filePath))) return null;
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
        // Malformed frontmatter - use empty
      }
    }

    const fileName = filePath.split("/").pop() || "";
    const { type, kind, isLayout, isProvider, isComponent, isPage } = detectEntityType(
      fileName,
      frontmatter,
    );

    const entity: Entity = {
      id: filePath,
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
  } catch {
    return null;
  }
}

export async function getEntityBySlug(
  projectDir: string,
  slug: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo | null> {
  const possiblePaths = [
    pathHelper.join(projectDir, "pages", `${slug}.mdx`),
    pathHelper.join(projectDir, "pages", `${slug}.tsx`),
    pathHelper.join(projectDir, "pages", `${slug}.jsx`),
    pathHelper.join(projectDir, "pages", `${slug}.ts`),
    pathHelper.join(projectDir, "pages", `${slug}/index.mdx`),
    pathHelper.join(projectDir, "pages", `${slug}/index.tsx`),
    pathHelper.join(projectDir, "pages", `${slug}/index.jsx`),
    pathHelper.join(projectDir, "pages", `${slug}/index.ts`),
    pathHelper.join(projectDir, `${slug}.mdx`),
    pathHelper.join(projectDir, `${slug}.tsx`),
    pathHelper.join(projectDir, `${slug}.ts`),
  ];

  if (slug === "index" || slug === "") {
    possiblePaths.unshift(
      pathHelper.join(projectDir, "pages", "index.mdx"),
      pathHelper.join(projectDir, "pages", "index.tsx"),
      pathHelper.join(projectDir, "pages", "index.ts"),
      pathHelper.join(projectDir, "index.mdx"),
      pathHelper.join(projectDir, "index.tsx"),
      pathHelper.join(projectDir, "index.ts"),
    );
  }

  // First try exact matches
  for (const p of possiblePaths) {
    const info = await getEntityInfo(p, adapter);
    if (info?.entity.isPage) return info;
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

        for (const entry of entries) {
          if (entry.isFile && /\[.+\]\.(mdx|tsx|jsx|ts|js)$/.test(entry.name)) {
            // Found a dynamic route file like [slug].tsx
            const dynamicPath = pathHelper.join(pagesDir, entry.name);
            const info = await getEntityInfo(dynamicPath, adapter);
            if (info?.entity.isPage) return info;
          }
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
  const possiblePaths = [
    pathHelper.join(projectDir, "layouts", `${layoutName}.mdx`),
    pathHelper.join(projectDir, "layouts", `${layoutName}.tsx`),
    pathHelper.join(projectDir, "components", `${layoutName}Layout.mdx`),
    pathHelper.join(projectDir, "components", `${layoutName}Layout.tsx`),
    pathHelper.join(projectDir, "components", "Layout.mdx"),
    pathHelper.join(projectDir, "components", "Layout.tsx"),
  ];

  for (const p of possiblePaths) {
    const info = await getEntityInfo(p, adapter);
    if (info?.entity.isLayout) return info;
  }
  return null;
}

export async function getProviderEntities(
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo[]> {
  const providers: EntityInfo[] = [];
  const providerDirs = [
    pathHelper.join(projectDir, "providers"),
    pathHelper.join(projectDir, "components"),
  ];

  for (const dir of providerDirs) {
    // Check directory existence using adapter with fallback
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

    if (dirExists) {
      const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
      // Use adapter's readDir if available, otherwise fall back to local fs
      const dirIterator = adapter?.fs.readDir
        ? adapter.fs.readDir(dir)
        : fs.readDir(dir);
      for await (const entry of dirIterator) {
        entries.push(entry);
      }

      for (const entry of entries) {
        if (entry.isFile) {
          const filePath = pathHelper.join(dir, entry.name);
          const info = await getEntityInfo(filePath, adapter);
          if (info?.entity.isProvider) {
            providers.push(info);
          }
        }
      }
    }
  }

  return providers.sort((a, b) => {
    const priorityA = typeof a.entity.frontmatter.priority === "number"
      ? a.entity.frontmatter.priority
      : 0;
    const priorityB = typeof b.entity.frontmatter.priority === "number"
      ? b.entity.frontmatter.priority
      : 0;
    return priorityA - priorityB;
  });
}

function getSlugFromPath(filePath: string): string {
  const parts = filePath.split(pathHelper.sep);
  const fileName = parts[parts.length - 1];
  const slug = (fileName ?? "").replace(/\.(mdx?|tsx?|jsx?|ts)$/, "");
  if (slug === "index") {
    const parentDir = parts[parts.length - 2];
    return parentDir === "pages" ? "" : parentDir || "";
  }
  return slug;
}
