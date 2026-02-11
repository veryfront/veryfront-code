import { COMPILATION_ERROR } from "#veryfront/errors/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { computeHash, rendererLogger as logger } from "#veryfront/utils";
import * as React from "react";
import { loadCompiledMDXModule } from "./mdx-module-loader.ts";
import type { MDXRenderOptions } from "./types.ts";

const log = logger.component("mdx");

export function renderMDXToReactAsync(
  compiledCode: string,
  options: MDXRenderOptions = {},
): Promise<React.ReactElement> {
  return withSpan(
    "mdx.renderToReact",
    async (): Promise<React.ReactElement> => {
      try {
        const cacheKey = (await computeHash(compiledCode)).slice(0, 16);
        const module = await loadCompiledMDXModule(compiledCode, cacheKey);

        const MDXContent = module.default ?? module.MDXContent;
        if (!MDXContent) {
          throw COMPILATION_ERROR.create({ detail: "No MDXContent found in compiled module" });
        }

        if (React.isValidElement(MDXContent)) {
          return MDXContent;
        }

        const mergedProps: Record<string, unknown> = {
          ...options,
          frontmatter: {
            ...(module.frontmatter ?? {}),
            ...(options.frontmatter ?? {}),
          },
        };

        return React.createElement(
          MDXContent as React.ComponentType<Record<string, unknown>>,
          mergedProps,
        );
      } catch (error) {
        log.error("Render error:", error);
        return createErrorElement(error);
      }
    },
    {},
  );
}

function createErrorElement(error: unknown): React.ReactElement {
  return React.createElement(
    "div",
    {
      style: {
        padding: "1rem",
        backgroundColor: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "0.375rem",
        color: "#dc2626",
      },
    },
    React.createElement("strong", {}, "MDX Render Error: "),
    error instanceof Error ? error.message : String(error),
  );
}
