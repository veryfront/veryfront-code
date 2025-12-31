import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MDXFrontmatter } from "@veryfront/types";
import type { VeryfrontConfig } from "@veryfront/config";
import type { BuildVersion } from "@veryfront/utils/version.ts";

export interface RendererOptions {
  projectDir: string;
  mode: "development" | "production";
  port?: number;
  adapter?: RuntimeAdapter;
  moduleServerUrl?: string;
  /** Pre-loaded config (avoids re-loading via FSAdapter) */
  config?: VeryfrontConfig;
  directories?: {
    app?: string;
    pages?: string;
    components?: string[];
  };
}

export interface RenderResult {
  html: string;
  css?: string;
  frontmatter: MDXFrontmatter;
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
  stream?: ReadableStream | null;
  pageModule?: {
    slug: string;
    code: string;
    type: "mdx" | "component";
  };
  ssrHash?: string;
}

export interface RenderOptions {
  params?: Record<string, string | string[]>;
  props?: Record<string, unknown>;
  delivery?: "string" | "stream";
  request?: Request;
  url?: URL;
  nonce?: string;
}

export interface RenderContext {
  slug: string;
  options?: RenderOptions;
}

/**
 * Page data response for SPA client-side navigation.
 * Contains all information needed to render a page client-side
 * without fetching pre-rendered HTML.
 */
export interface PageDataResponse {
  /** URL slug for the page */
  slug: string;
  /** Relative path to the page component (e.g., "pages/about.tsx") */
  pagePath: string;
  /** Page component type */
  pageType: "mdx" | "tsx" | "jsx" | "ts" | "js";
  /** Nested layouts to wrap the page, from outermost to innermost */
  layouts: Array<{
    kind: "mdx" | "tsx";
    path: string;
  }>;
  /** Provider component paths */
  providers: string[];
  /** Page frontmatter/metadata */
  frontmatter: Record<string, unknown>;
  /** Props from getServerData/getStaticData */
  props: Record<string, unknown>;
  /** Route parameters */
  params: Record<string, string | string[]>;
  /** Layout-specific props keyed by layout path */
  layoutProps: Record<string, Record<string, unknown>>;
  /** Build version for cache invalidation during SPA navigation */
  buildVersion: BuildVersion;
}
