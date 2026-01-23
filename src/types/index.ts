import type * as React from "react";

export type {
  BundleResult,
  BundlerOptions,
  EmbeddedBundleManifest,
  MDXBundleOptions,
  MDXBundleResult,
} from "./bundler.ts";

export type {
  AppRouteMatch,
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
  MiddlewareFunction,
  MiddlewareFunction as ServerMiddlewareFunction,
  ParsedDomain,
  RouteHandlerModule,
  RoutePattern,
  RouteRegistryConfig,
  SecurityConfig,
} from "./server.ts";

export type {
  ClientComponentMeta,
  ComponentAnalysis,
  ComponentType,
  RSCHydratorOptions,
  RSCNode,
  RSCPayload,
  RSCRendererOptions,
} from "./rsc.ts";

export type {
  HMRConnectedMessage,
  HMRMessage,
  HMRMessageType,
  HMRReloadMessage,
  HMRUpdateMessage,
} from "./hmr.ts";

export type {
  BundleInfo,
  Entity,
  EntityInfo,
  EntityTypeInfo,
  Frontmatter,
  LoaderData,
} from "./entities.ts";

export type { AppProps } from "./app.ts";

// Branded types for compile-time domain type safety
export type {
  AgentId,
  ApiKey,
  // Security tokens
  AuthToken,
  // Brand types
  Brand,
  CsrfToken,
  // Entity/Resource identifiers
  EntityId,
  LayoutId,
  MessageId,
  PageId,
  PromptId,
  // Request/Response identifiers
  RequestId,
  ResourceId,
  SessionId,
  // Content identifiers
  Slug,
  ToolCallId,
  ToolId,
  Unbrand,
  // User/Agent identifiers
  UserId,
} from "./branded.ts";

export { brandValue, isBrandedString, unbrandValue } from "./branded.ts";

/** Props for any React component */
export type ComponentProps = Record<string, unknown>;

/** A React component that accepts ComponentProps */
export type Component = React.ComponentType<ComponentProps>;

/** A function component that returns a React element or null */
export type ComponentFunction = (props: ComponentProps) => React.ReactElement | null;

/** Map of component names to React components for MDX */
export type MDXComponents = Record<string, React.ComponentType<unknown>>;

/**
 * Frontmatter metadata for MDX pages.
 * Extended from base Frontmatter with MDX-specific fields.
 */
export interface MDXFrontmatter {
  /** Page title */
  title?: string;
  /** Page description for SEO */
  description?: string;
  /** Layout component path or false to disable */
  layout?: string | boolean;
  /** AI provider for the page */
  provider?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Publication date */
  date?: string;
  /** Whether the page is published */
  published?: boolean;
  /** Priority for sitemap generation */
  priority?: number;
  /** Allow additional frontmatter fields */
  [key: string]: string | number | boolean | string[] | undefined;
}

/** Global variables available in MDX context */
export interface MDXGlobals {
  [key: string]: unknown;
}

/** Context passed to page components during rendering */
export interface PageContext {
  /** URL slug for the page */
  slug: string;
  /** Full path to the page file */
  path: string;
  /** Parsed frontmatter */
  frontmatter: MDXFrontmatter;
  /** URL path parameters */
  params?: Record<string, string>;
  /** URL query parameters */
  query?: Record<string, string>;
}

/** Context for middleware request handling */
export interface RequestContext {
  /** The incoming request */
  request: Request;
  /** URL path parameters */
  params?: Record<string, string>;
  /** URL query parameters */
  query?: Record<string, string>;
  /** Request headers */
  headers?: Headers;
}

/** Generic cache entry with optional TTL */
export interface CacheEntry<T = unknown> {
  /** Cached value */
  value: T;
  /** Time-to-live in milliseconds */
  ttl?: number;
  /** Timestamp when cached */
  timestamp?: number;
}

/** A value that may be wrapped in a Promise */
export type MaybePromise<T> = T | Promise<T>;

/** Recursively make all properties optional */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface MdxBundle {
  compiledCode: string;
  frontmatter?: MDXFrontmatter;
  globals?: MDXGlobals;
}

export interface LayoutItem {
  kind: "mdx" | "tsx";
  bundle?: MdxBundle;
  component?: React.ComponentType | unknown;
  componentPath?: string;
  path?: string;
}

export interface PageBundle extends MdxBundle {
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
  clientModuleCode?: string;
}

export interface MDXModule {
  MDXContent?: React.ComponentType<{ components?: MDXComponents }>;
  MDXLayout?: React.ComponentType;
  MainLayout?: React.ComponentType;
  default?: React.ComponentType;
  metadata?: Record<string, unknown>;
  generateMetadata?: (ctx: PageContext) => MaybePromise<Record<string, unknown>>;
}

export interface ScriptPageModule {
  render?: (ctx: PageContext) => MaybePromise<
    | string
    | Response
    | {
      html: string;
      frontmatter?: MDXFrontmatter;
      meta?: MDXFrontmatter;
    }
  >;
  default?: ((ctx: PageContext) => MaybePromise<string | Response>) | string;
  html?: string;
  generateMetadata?: (ctx: PageContext) => MaybePromise<Record<string, unknown>>;
}

export interface Bundler {
  bundleTsxSourceToComponent?: (
    content: string,
    filePath: string,
    projectDir: string,
  ) => Promise<React.ComponentType>;
}

export interface RenderMetadata {
  title?: string;
  description?: string;
  slug?: string;
  frontmatter?: MDXFrontmatter;
  layoutFrontmatter?: MDXFrontmatter;
  layout?: string | false;
  bodyClass?: string;
  lang?: string;
  ssrHash?: string;
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

// CSS types are defined in src/build/asset-pipeline/css-optimizer/types/index.ts
// Re-export for backwards compatibility
export type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
  CSSProcessingResult,
  LightningCSSModule,
  LightningCSSTransformOptions,
  LightningCSSTransformResult,
  SelectorExtractionResult,
} from "../build/asset-pipeline/css-optimizer/types/index.ts";

// Entity utilities
export { getEntityBySlug, getEntityInfo, getLayoutEntity } from "./entities/getEntityInfo.ts";
