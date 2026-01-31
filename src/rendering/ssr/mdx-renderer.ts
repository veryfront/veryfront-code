import { CompilationError } from "#veryfront/errors/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import * as React from "react";
import { loadCompiledMDXModule } from "./mdx-module-loader.ts";
import type { MDXRenderOptions } from "./types.ts";

export function renderMDXToReactAsync(
  compiledCode: string,
  options: MDXRenderOptions = {},
): Promise<React.ReactElement> {
  return withSpan(
    "mdx.renderToReact",
    async (): Promise<React.ReactElement> => {
      try {
        const cacheKey = await hashCode(compiledCode);
        const module = await loadCompiledMDXModule(compiledCode, cacheKey);

        const MDXContent = module.default ?? module.MDXContent;
        if (!MDXContent) {
          throw new CompilationError("No MDXContent found in compiled module");
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
        logger.error("[MDX] Render error:", error);
        return createErrorElement(error);
      }
    },
    {},
  );
}

const HEX_CHARS = "0123456789abcdef";

async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i]!;
    hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
  }
  return hex;
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
