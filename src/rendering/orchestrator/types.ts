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
  config?: VeryfrontConfig;
  /** Project ID (UUID) for SSR cache isolation in multi-project mode */
  projectId?: string;
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
  studioEmbed?: boolean;
  projectId?: string;
  pageId?: string;
  colorScheme?: "light" | "dark";
  proxyEnvironment?: "preview" | "production";
  /** Project slug for HTTP fallback in multi-project mode */
  projectSlug?: string;
}

export interface RenderContext {
  slug: string;
  options?: RenderOptions;
}

/** Page data for SPA client-side navigation without pre-rendered HTML. */
export interface PageDataResponse {
  slug: string;
  pagePath: string;
  pageType: "mdx" | "tsx" | "jsx" | "ts" | "js";
  layouts: Array<{ kind: "mdx" | "tsx"; path: string }>;
  providers: string[];
  frontmatter: Record<string, unknown>;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layoutProps: Record<string, Record<string, unknown>>;
  buildVersion: BuildVersion;
  appPath?: string;
  /** Headings extracted from MDX for sidebar/TOC navigation */
  headings?: Array<{ id: string; text: string; level: number }>;
}
