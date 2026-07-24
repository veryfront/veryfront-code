import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RenderResult } from "#veryfront/types";
import type { BuildVersion } from "#veryfront/utils/version.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

export type { RenderResult };

export interface RendererOptions {
  projectDir: string;
  mode: "development" | "production";
  /** Whether browser-facing local filesystem module URLs are trusted. */
  isLocalProject?: boolean;
  port?: number;
  adapter?: RuntimeAdapter;
  moduleServerUrl?: string;
  config?: VeryfrontConfig;
  /** Project ID (UUID) for SSR cache isolation in multi-project mode */
  projectId?: string;
  /** Project slug for logging and HTTP fallback */
  projectSlug?: string;
  /** Content source identifier for cache isolation (branch or release) */
  contentSourceId?: string;
  directories?: {
    app?: string;
    pages?: string;
    components?: string[];
  };
}

export interface RenderOptions {
  params?: Record<string, string | string[]>;
  props?: Record<string, unknown>;
  delivery?: "string" | "stream";
  request?: Request;
  /** Internal signal for the render owner's total deadline. */
  abortSignal?: AbortSignal;
  url?: URL;
  /** Restrict data fetching to static hooks, even when a request context exists. */
  staticDataOnly?: boolean;
  /** Optional cache key override; defaults to slug + normalized query params (without page/theme prefix) */
  cacheKey?: string;
  nonce?: string;
  studioEmbed?: boolean;
  projectId?: string;
  pageId?: string;
  colorScheme?: "light" | "dark";
  /** Whether colorScheme was set via color_mode URL param (needs localStorage persistence) */
  colorSchemeFromParam?: boolean;
  /** Whether colorScheme was set via Sec-CH-Prefers-Color-Scheme header */
  colorSchemeFromHeader?: boolean;
  /** Deployment environment (preview or production) */
  environment?: "preview" | "production";
  /** Project slug for HTTP fallback in multi-project mode */
  projectSlug?: string;
  /** Content source identifier for cache isolation (branch name or release ID) */
  contentSourceId?: string;
  /** Release ID for production renders (drives release asset manifest consumption) */
  releaseId?: string;
  /** Request-scoped ready release asset manifest, shared by cache keys and HTML generation. */
  releaseAssetManifest?: ReleaseAssetManifest | null;
  /** Skip cache check in pipeline (cache already checked by Renderer) */
  skipCacheCheck?: boolean;
  /** Skip cache persistence (used for prefetch/aux renders like CSS generation) */
  skipCachePersist?: boolean;
  /** Disable HMR scripts (for embedded iframes where WebSocket is unwanted) */
  noHmr?: boolean;
  /** Force production client scripts even when rendering a local project */
  forceProductionScripts?: boolean;
  /** Internal SSR module-tracking session id for first-response manifest preloads */
  renderSessionId?: string;
  /** Project-relative layout props serialized for browser reconstruction. */
  layoutProps?: Record<string, Record<string, unknown>>;
  /** Internal server/client ownership plan for App Router page hydration. */
  clientPageIsland?: {
    clientLayoutPaths: string[];
    hasServerLayouts: boolean;
  };
}

export interface RenderContext {
  slug: string;
  options?: RenderOptions;
}

/** Page data for SPA client-side navigation without pre-rendered HTML. */
export interface PageDataResponse {
  slug: string;
  pagePath: string;
  pageType: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
  layouts: Array<{ kind: "mdx" | "tsx"; path: string }>;
  providers: string[];
  frontmatter: Record<string, unknown>;
  props: Record<string, unknown>;
  params: Record<string, string | string[]>;
  layoutProps: Record<string, Record<string, unknown>>;
  buildVersion: BuildVersion;
  appPath?: string;
  /** Page and client layout modules render inside a server-owned layout island. */
  isolatedClientPage?: boolean;
  /** Server-owned layout markup requires a document navigation for this target. */
  requiresFullDocumentNavigation?: boolean;
  /** Production release id used to version fallback module URLs. */
  releaseId?: string;
  /** Production release asset URLs keyed by logical source path. */
  releaseAssetModules?: Record<string, string>;
  /** Headings extracted from MDX for sidebar/TOC navigation */
  headings?: Array<{ id: string; text: string; level: number }>;
  /** JIT-compiled Tailwind CSS for this page (for SPA navigation in prod mode) */
  css?: string;
  /** Client action for the SPA CSS tag when no route CSS payload is sent. */
  cssAction?: "clear";
  /**
   * Error message if CSS generation failed.
   * When set, the css field will be undefined and clients should fall back
   * to inline styles or show a warning. This surfaces silent CSS failures
   * instead of serving broken pages with no indication of the problem.
   */
  cssError?: string;
}
