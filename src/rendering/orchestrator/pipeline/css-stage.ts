import { extractCandidates, generateTailwindCSS } from "#veryfront/html/styles-builder/index.ts";
import {
  getCSSByHashAsync,
  regenerateCSSByHash,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { withTimeout } from "../../utils/stream-utils.ts";
import {
  cachePageCss,
  CSS_SSR_TIMEOUT_MS,
  getCachedPageCss,
  getPageCssCacheKey,
} from "../css-cache.ts";
import type { RenderOptions, RenderResult } from "../types.ts";

const resolvePageDataLog = logger.component("resolve-page-data");
const RENDERED_CSS_HASH_RE = /href="\/_vf\/css\/([a-z0-9-]{1,16})\.css"/i;

export interface PageCssResult {
  css: string | undefined;
  cssError: string | undefined;
}

export interface ResolvePageDataCssStageOptions {
  slug: string;
  options: RenderOptions | undefined;
  projectUpdatedAt: string | undefined;
  renderPage: (slug: string, options?: RenderOptions) => Promise<RenderResult>;
  resolveCssFromRenderedHtml?: (
    html: string,
    projectSlug: string | undefined,
  ) => Promise<string | undefined>;
}

export function extractRenderedCssHash(html: string): string | undefined {
  return html.match(RENDERED_CSS_HASH_RE)?.[1];
}

export async function resolveCssFromRenderedHtml(
  html: string,
  projectSlug: string | undefined,
): Promise<string | undefined> {
  const cssHash = extractRenderedCssHash(html);
  if (!cssHash) return undefined;

  const cachedCss = await getCSSByHashAsync(cssHash);
  if (cachedCss) return cachedCss;

  return await regenerateCSSByHash(cssHash, projectSlug);
}

export async function resolvePageDataCssStage({
  slug,
  options,
  projectUpdatedAt,
  renderPage,
  resolveCssFromRenderedHtml: resolveCssFromRenderedHtmlFn = resolveCssFromRenderedHtml,
}: ResolvePageDataCssStageOptions): Promise<PageCssResult> {
  const cssCacheKey = getPageCssCacheKey(
    options?.projectId,
    options?.environment,
    slug,
    projectUpdatedAt,
  );

  const cachedCss = getCachedPageCss(cssCacheKey);
  if (cachedCss) {
    resolvePageDataLog.debug("CSS cache hit", { slug, cssLength: cachedCss.length });
    return { css: cachedCss, cssError: undefined };
  }

  try {
    const renderResult = await withTimeout(
      renderPage(slug, {
        ...options,
        delivery: "string",
        skipCacheCheck: true,
        skipCachePersist: true,
      }),
      CSS_SSR_TIMEOUT_MS,
      `CSS SSR for ${slug}`,
    );

    if (!renderResult?.html) {
      return { css: undefined, cssError: undefined };
    }

    let css = await resolveCssFromRenderedHtmlFn(
      renderResult.html,
      options?.projectSlug ?? options?.projectId,
    );

    if (css) {
      resolvePageDataLog.debug("Reused SSR CSS for page data", {
        slug,
        cssLength: css.length,
        source: "rendered-html-hash",
      });
    } else {
      css = await generatePageCssFromHtmlStage(slug, renderResult.html, options);
    }

    if (css) cachePageCss(cssCacheKey, css);
    return { css, cssError: undefined };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Surface CSS generation failures instead of silently swallowing them.
    // This allows clients to show a warning or fall back gracefully.
    resolvePageDataLog.error("CSS generation failed", {
      slug,
      error: errorMessage,
      projectId: options?.projectId,
    });
    return {
      css: undefined,
      cssError: `CSS generation failed: ${errorMessage}`,
    };
  }
}

export async function generatePageCssFromHtmlStage(
  slug: string,
  html: string,
  options: RenderOptions | undefined,
): Promise<string | undefined> {
  const candidates = extractCandidates(html);
  const generatedCss = (await generateTailwindCSS(undefined, candidates, {
    projectSlug: options?.projectSlug,
  })).css;

  resolvePageDataLog.debug("Fell back to HTML candidate CSS generation", {
    slug,
    htmlLength: html.length,
    cssLength: generatedCss?.length || 0,
  });

  return generatedCss;
}
