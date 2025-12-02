import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "@std/path";
import * as React from "react";
import type { MDXComponents, MDXFrontmatter, MDXModule } from "./types.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

export async function loadCompiledMDX(modulePath: string): Promise<MDXModule | null> {
  try {
    const module = await import(modulePath);
    return module as MDXModule;
  } catch (_error) {
    logger.error(`Failed to load MDX module from ${modulePath}:`, _error);
    return null;
  }
}

export function getCompiledMDXPath(
  projectDir: string,
  slug: string,
  type: "pages" | "layouts" | "providers" = "pages",
): string {
  const fileName = slug === "/" ? "index" : slug;
  return join(projectDir, ".veryfront", "compiled", type, `${fileName}.js`);
}

export async function renderCompiledMDX(
  projectDir: string,
  slug: string,
  components: MDXComponents = {
    /* empty */
  },
  type: "pages" | "layouts" | "providers" = "pages",
): Promise<{ element: React.ReactElement; frontmatter: MDXFrontmatter } | null> {
  const modulePath = getCompiledMDXPath(projectDir, slug, type);
  try {
    const { loadMDXModule } = await import("./module-loader/index.ts");
    const module = await loadMDXModule(modulePath, projectDir);
    if (!module) return null;
    const Component = module.MDXContent || module.MDXWrapper || module.default;
    if (!Component) {
      logger.error(`No component found in MDX module: ${modulePath}`);
      return null;
    }
    const element = React.createElement(Component, { components });
    return {
      element,
      frontmatter: module.frontmatter ||
        {
          /* empty */
        },
    };
  } catch (_error) {
    logger.error(`Failed to render compiled MDX from ${modulePath}:`, _error);
    return null;
  }
}

export async function hasCompiledMDX(
  projectDir: string,
  slug: string,
  type: "pages" | "layouts" | "providers" = "pages",
): Promise<boolean> {
  const modulePath = getCompiledMDXPath(projectDir, slug, type);
  logger.debug(`Checking for compiled MDX at: ${modulePath}`);
  try {
    const fs = createFileSystem();
    const stat = await fs.stat(modulePath);
    logger.debug(`Found compiled MDX file: ${modulePath}, size: ${stat.size}`);
    return true;
  } catch (_error) {
    logger.debug(`No compiled MDX found at: ${modulePath}, error: ${(_error as Error).message}`);

    return false;
  }
}
