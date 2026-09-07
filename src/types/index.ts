/**
 * Shared type definitions — server/handler types, branded IDs, React component
 * contracts, page/request contexts, and bundler config.
 *
 * @module types
 */

import type * as React from "react";
import type { ResponseCookie } from "#veryfront/data/types.ts";

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
  RSCChildrenPayload,
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

/** React elements accepted as compiled-MDX component overrides. */
export type MDXComponents = Record<string, React.ElementType>;

/** Parsed frontmatter values from an MDX page. */
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

/** Runtime page context passed to page components. */
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

export type MaybePromise<T> = T | Promise<T>;

export interface MdxBundle {
  compiledCode: string;
  /** Original file identity for prepared imports. Absent for anonymous inline bundles. */
  sourcePath?: string;
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
  /** Validated application headers appended after framework-owned headers. */
  headers?: Record<string, string>;
  /** Distinct cookies serialized as separate Set-Cookie response fields. */
  cookies?: ResponseCookie[];
}

export type {
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
  CSSProcessingResult,
  SelectorExtractionResult,
} from "#veryfront/build/asset-pipeline/css-optimizer/types/index.ts";

export { getEntityBySlug, getEntityInfo, getLayoutEntity } from "./entities/getEntityInfo.ts";
