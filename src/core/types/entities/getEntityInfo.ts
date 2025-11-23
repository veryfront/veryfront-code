import { extract } from "std/front_matter/yaml.ts";
import { exists } from "std/fs/exists.ts";
import { extname, join } from "std/path/mod.ts";
import { detectEntityType } from "../entities.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import type { Entity, EntityInfo, Frontmatter } from "../entities.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { withFallback } from "@veryfront/platform/adapters/index.ts";

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
            const exists = await Deno.stat(filePath).then(() => true).catch(() => false);
            if (!exists) {
              throw toError(
                createError({
                  type: "file",
                  message: "File not found",
                  context: { path: filePath, operation: "read" },
                }),
              );
            }
            return await Deno.stat(filePath);
          },
          { operationName: "stat:getEntityInfo", logError: false },
        );
        if (!stat.isFile) return null;
      } catch {
        return null;
      }
    } else {
      if (!(await exists(filePath))) return null;
    }

    const content = adapter
      ? await withFallback(
        () => adapter.fs.readFile(filePath),
        () => Deno.readTextFile(filePath),
        { operationName: "readFile:getEntityInfo", logError: false },
      )
      : await Deno.readTextFile(filePath);
    const ext = extname(filePath).toLowerCase();

    let frontmatter: Frontmatter = {};
    let body = content;

    if ([".md", ".mdx"].includes(ext)) {
      try {
        const extracted = extract(content);
        frontmatter = extracted.attrs as Frontmatter;
        body = extracted.body;
      } catch {
        // ignore
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
    join(projectDir, "pages", `${slug}.mdx`),
    join(projectDir, "pages", `${slug}.tsx`),
    join(projectDir, "pages", `${slug}.jsx`),
    join(projectDir, "pages", `${slug}.ts`),
    join(projectDir, "pages", `${slug}/index.mdx`),
    join(projectDir, "pages", `${slug}/index.tsx`),
    join(projectDir, "pages", `${slug}/index.jsx`),
    join(projectDir, "pages", `${slug}/index.ts`),
    join(projectDir, `${slug}.mdx`),
    join(projectDir, `${slug}.tsx`),
    join(projectDir, `${slug}.ts`),
  ];

  if (slug === "index" || slug === "") {
    possiblePaths.unshift(
      join(projectDir, "pages", "index.mdx"),
      join(projectDir, "pages", "index.tsx"),
      join(projectDir, "pages", "index.ts"),
      join(projectDir, "index.mdx"),
      join(projectDir, "index.tsx"),
      join(projectDir, "index.ts"),
    );
  }

  // First try exact matches
  for (const path of possiblePaths) {
    const info = await getEntityInfo(path, adapter);
    if (info?.entity.isPage) return info;
  }

  // If no exact match found, try dynamic routes with [param] notation
  // e.g., slug "blog/my-post" should match "pages/blog/[slug].tsx"
  const slugParts = slug.split("/");

  // Try to match dynamic routes for all path depths
  for (let depth = slugParts.length - 1; depth >= 0; depth--) {
    const parentPath = slugParts.slice(0, depth).join("/");
    const pagesDir = parentPath ? join(projectDir, "pages", parentPath) : join(projectDir, "pages");

    try {
      // Check if directory exists
      let dirExists = false;
      if (adapter) {
        try {
          const stat = await withFallback(
            () => adapter.fs.stat(pagesDir),
            () => Deno.stat(pagesDir),
            { operationName: "stat:getEntityBySlug", logError: false },
          );
          dirExists = stat.isDirectory;
        } catch {
          dirExists = false;
        }
      } else {
        dirExists = await exists(pagesDir);
      }

      if (dirExists) {
        // Look for files with [param] pattern in the directory
        const entries = adapter?.fs.readDir
          ? await withFallback(
            () => Promise.resolve(adapter.fs.readDir(pagesDir)),
            () => Promise.resolve(Deno.readDir(pagesDir)),
            { operationName: "readDir:getEntityBySlug", logError: false },
          )
          : Deno.readDir(pagesDir);

        for await (const entry of entries) {
          if (entry.isFile && /\[.+\]\.(mdx|tsx|jsx|ts|js)$/.test(entry.name)) {
            // Found a dynamic route file like [slug].tsx
            const dynamicPath = join(pagesDir, entry.name);
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
    join(projectDir, "layouts", `${layoutName}.mdx`),
    join(projectDir, "layouts", `${layoutName}.tsx`),
    join(projectDir, "components", `${layoutName}Layout.mdx`),
    join(projectDir, "components", `${layoutName}Layout.tsx`),
    join(projectDir, "components", "Layout.mdx"),
    join(projectDir, "components", "Layout.tsx"),
  ];

  for (const path of possiblePaths) {
    const info = await getEntityInfo(path, adapter);
    if (info?.entity.isLayout) return info;
  }
  return null;
}

export async function getProviderEntities(
  projectDir: string,
  adapter?: RuntimeAdapter,
): Promise<EntityInfo[]> {
  const providers: EntityInfo[] = [];
  const providerDirs = [join(projectDir, "providers"), join(projectDir, "components")];

  for (const dir of providerDirs) {
    // Check directory existence using adapter with fallback
    let dirExists = false;
    if (adapter) {
      try {
        const stat = await withFallback(
          () => adapter.fs.stat(dir),
          () => Deno.stat(dir),
          { operationName: "stat:getProviderEntities", logError: false },
        );
        dirExists = stat.isDirectory;
      } catch {
        dirExists = false;
      }
    } else {
      dirExists = await exists(dir);
    }

    if (dirExists) {
      const entries = adapter?.fs.readDir
        ? await withFallback(
          () => Promise.resolve(adapter.fs.readDir(dir)),
          () => Promise.resolve(Deno.readDir(dir)),
          { operationName: "readDir:getProviderEntities", logError: false },
        )
        : Deno.readDir(dir);

      for await (const entry of entries) {
        if (entry.isFile) {
          const filePath = join(dir, entry.name);
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
  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1];
  const slug = (fileName ?? "").replace(/\.(mdx?|tsx?|jsx?|ts)$/, "");
  if (slug === "index") {
    const parentDir = parts[parts.length - 2];
    return parentDir === "pages" ? "" : parentDir || "";
  }
  return slug;
}
