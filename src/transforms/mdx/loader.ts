import { rendererLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path";
import * as React from "react";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { MDXComponents, MDXFrontmatter, MDXModule } from "./types.ts";

function loadCompiledMDX(modulePath: string): Promise<MDXModule | null> {
  return withSpan(
    "transforms.mdx.loadCompiledMDX",
    async () => {
      try {
        return (await import(modulePath)) as MDXModule;
      } catch (error) {
        logger.error(`Failed to load MDX module from ${modulePath}:`, error);
        return null;
      }
    },
    { "mdx.module_path": modulePath },
  );
}

function getCompiledMDXPath(
  projectDir: string,
  slug: string,
  type: "pages" | "layouts" | "providers" = "pages",
): string {
  const fileName = slug === "/" ? "index" : slug;
  return join(projectDir, ".veryfront", "compiled", type, `${fileName}.js`);
}

function renderCompiledMDX(
  projectDir: string,
  slug: string,
  components: MDXComponents = {},
  type: "pages" | "layouts" | "providers" = "pages",
): Promise<{ element: React.ReactElement; frontmatter: MDXFrontmatter } | null> {
  return withSpan(
    "transforms.mdx.renderCompiledMDX",
    async () => {
      const modulePath = getCompiledMDXPath(projectDir, slug, type);

      try {
        const { loadMDXModule } = await import("./module-loader/index.ts");
        const module = await loadMDXModule(modulePath, projectDir);
        if (!module) return null;

        const Component = module.MDXContent ?? module.MDXWrapper ?? module.default;
        if (!Component) {
          logger.error(`No component found in MDX module: ${modulePath}`);
          return null;
        }

        return {
          element: React.createElement(Component, { components }),
          frontmatter: module.frontmatter ?? {},
        };
      } catch (error) {
        logger.error(`Failed to render compiled MDX from ${modulePath}:`, error);
        return null;
      }
    },
    { "mdx.slug": slug, "mdx.type": type },
  );
}

function hasCompiledMDX(
  projectDir: string,
  slug: string,
  type: "pages" | "layouts" | "providers" = "pages",
): Promise<boolean> {
  return withSpan(
    "transforms.mdx.hasCompiledMDX",
    async () => {
      const modulePath = getCompiledMDXPath(projectDir, slug, type);
      logger.debug(`Checking for compiled MDX at: ${modulePath}`);

      try {
        const fs = createFileSystem();
        const fileStat = await fs.stat(modulePath);
        logger.debug(`Found compiled MDX file: ${modulePath}, size: ${fileStat.size}`);
        return true;
      } catch (error) {
        logger.debug(
          `No compiled MDX found at: ${modulePath}, error: ${getErrorMessage(error)}`,
        );
        return false;
      }
    },
    { "mdx.slug": slug, "mdx.type": type },
  );
}
