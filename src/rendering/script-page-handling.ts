
import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "std/path/mod.ts";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import { createError, toError } from "../core/errors/veryfront-error.ts";
import type {
  ComponentProps,
  EntityInfo,
  MDXFrontmatter,
  PageContext,
  RenderResult,
  ScriptPageModule,
} from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { DEFAULT_DASHBOARD_PORT } from "@veryfront/utils";
import { getContentHash } from "./utils/index.ts";
import { type HTMLGenerationOptions, wrapInHTMLShell } from "@veryfront/html";
import { extractHTMLMetadata, injectHTMLContent, isFullHTMLDocument } from "@veryfront/html";
import { detectAppRouter } from "./router-detection.ts";

export async function handleScriptPage(
  pageInfo: EntityInfo,
  slug: string,
  options: {
    mode: string;
    config: VeryfrontConfig;
    projectDir: string;
    adapter: RuntimeAdapter;
    params?: Record<string, string | string[]>;
    props?: ComponentProps;
    nonce?: string;
  },
): Promise<RenderResult> {
  try {
    logger.info(`Loading TS/JS page module: ${pageInfo.entity.id}`);
    const mod = (await import(`file://${pageInfo.entity.id}?t=${Date.now()}`)) as ScriptPageModule;

    const ctx: PageContext = {
      params: options.params
        ? (Object.fromEntries(
          Object.entries(options.params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
        ) as Record<string, string>)
        : {},
      slug,
      path: pageInfo.entity.id,
      frontmatter: pageInfo.entity.frontmatter || {},
    };

    let output:
      | string
      | Response
      | {
        html: string;
        frontmatter?: MDXFrontmatter;
        meta?: MDXFrontmatter;
      }
      | null = null;
    if (typeof mod?.render === "function") {
      output = await mod.render(ctx);
    } else if (typeof mod?.default === "function") {
      output = await mod.default(ctx);
    } else if (typeof mod?.default === "string") {
      output = mod.default;
    } else if (typeof mod?.html === "string") {
      output = mod.html;
    } else {
      throw toError(createError({
        type: "render",
        message:
          "Script page must export a 'render(ctx)' function, a default function, or a string HTML",
      }));
    }

    if (output instanceof Response) {
      output = await output.text();
    }

    let htmlBody: string;
    let metaFromScript: Record<string, unknown> = {};
    let collectedMetadata: Record<string, unknown> = {};

    try {
      if (typeof mod?.generateMetadata === "function") {
        const gen = await mod.generateMetadata(ctx);
        if (gen && typeof gen === "object") {
          collectedMetadata = {
            ...collectedMetadata,
            ...(gen as Record<string, unknown>),
          };
          metaFromScript = {
            ...metaFromScript,
            ...(gen as Record<string, unknown>),
          };
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      logger.warn("generateMetadata threw for TS/JS page", error);
      if (error.message.includes("ReferenceError") || error.message.includes("SyntaxError")) {
        throw error;
      }
    }

    if (typeof output === "string") {
      htmlBody = output;
    } else if (output && typeof output === "object" && typeof output.html === "string") {
      htmlBody = output.html;
      metaFromScript = output.frontmatter || output.meta || {};
    } else if (output && typeof output === "object") {
      htmlBody = `<pre>${JSON.stringify(output, null, 2)}</pre>`;
    } else {
      throw toError(createError({
        type: "render",
        message: "Unsupported script page return type",
      }));
    }

    const useAppRouter = await detectAppRouter(
      options.projectDir,
      options.config,
      options.adapter,
    );
    const appComponentPath = useAppRouter
      ? undefined
      : await resolveAppComponentPath(options.projectDir, options.adapter);

    const mergedFrontmatter = {
      ...pageInfo.entity.frontmatter,
      ...metaFromScript,
      ...collectedMetadata,
    } as MDXFrontmatter;

    let fullHtml: string;
    if (isFullHTMLDocument(htmlBody)) {
      const metadata = extractHTMLMetadata(mergedFrontmatter, undefined);
      fullHtml = injectHTMLContent(htmlBody, "", metadata, {
        mode: options.mode,
        slug,
        devPort: options.config?.dev?.port || DEFAULT_DASHBOARD_PORT,
      });
    } else {
      const htmlOptions: HTMLGenerationOptions = {
        mode: options.mode as "development" | "production",
        config: options.config,
        nestedLayouts: [],
        providerPaths: [],
        appPath: appComponentPath,
        nonce: options.nonce,
      };
      fullHtml = await wrapInHTMLShell(
        htmlBody,
        {
          title: (typeof metaFromScript.title === "string" ? metaFromScript.title : undefined) ||
            pageInfo.entity.frontmatter?.title ||
            "Veryfront App",
          description: (typeof metaFromScript.description === "string"
            ? metaFromScript.description
            : undefined) ||
            pageInfo.entity.frontmatter?.description ||
            "",
          slug,
          frontmatter: {
            ...mergedFrontmatter,
          },
          layoutFrontmatter: undefined,
          ssrHash: undefined,
        },
        htmlOptions,
        options.params,
        options.props,
      );
    }

    const ssrHash = await getContentHash(fullHtml);

    const result: RenderResult = {
      html: fullHtml,
      frontmatter: mergedFrontmatter,
      headings: [],
      nodeMap: undefined,
      stream: null,
      ssrHash,
    };

    return result;
  } catch (error) {
    throw new VeryfrontError(
      `Failed to render TS/JS page: ${error instanceof Error ? error.message : String(error)}`,
      ErrorCode.RENDER_ERROR,
      { slug, error },
    );
  }
}

async function resolveAppComponentPath(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string | undefined> {
  const candidate = join(projectDir, "components/app.tsx");
  return (await adapter.fs.exists(candidate)) ? candidate : undefined;
}
