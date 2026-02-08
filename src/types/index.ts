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
  HandlerResult,
  MiddlewareFunction,
  MiddlewareFunction as ServerMiddlewareFunction,
  ParsedDomain,
  RouteHandlerModule,
  RoutePattern,
  RouteRegistryConfig,
  SecurityConfig,
} from "./server.ts";
export { HandlerPriority } from "./server.ts";
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

export type {
  AgentId,
  ApiKey,
  AuthToken,
  Brand,
  CsrfToken,
  EntityId,
  LayoutId,
  MessageId,
  PageId,
  PromptId,
  RequestId,
  ResourceId,
  SessionId,
  Slug,
  ToolCallId,
  ToolId,
  Unbrand,
  UserId,
} from "./branded.ts";

export type ComponentProps = Record<string, unknown>;

export type Component = React.ComponentType<ComponentProps>;

export type ComponentFunction = (
  props: ComponentProps,
) => React.ReactElement | null;

export type MDXComponents = Record<string, React.ComponentType<unknown>>;

export interface MDXFrontmatter {
  title?: string;
  description?: string;
  layout?: string | boolean;
  provider?: string;
  tags?: string[];
  date?: string;
  published?: boolean;
  priority?: number;
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface MDXGlobals {
  [key: string]: unknown;
}

export interface PageContext {
  slug: string;
  path: string;
  frontmatter: MDXFrontmatter;
  params?: Record<string, string>;
  query?: Record<string, string>;
}

export interface RequestContext {
  request: Request;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Headers;
}

export interface CacheEntry<T = unknown> {
  value: T;
  ttl?: number;
  timestamp?: number;
}

export type MaybePromise<T> = T | Promise<T>;

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
  render?: (
    ctx: PageContext,
  ) => MaybePromise<
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
} from "#veryfront/build/asset-pipeline/css-optimizer/types/index.ts";

export { getEntityBySlug, getEntityInfo, getLayoutEntity } from "./entities/getEntityInfo.ts";
