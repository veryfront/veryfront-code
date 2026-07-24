/**
 * Shared type definitions: server and handler types, branded IDs, React component
 * contracts, page/request contexts, and bundler config.
 *
 * @module types
 */

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
  ParsedDomain,
  RouteHandler,
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
  HMRPingMessage,
  HMRPongMessage,
  HMRProtocolMessage,
  HMRProtocolMessageType,
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

/** Generic props accepted by Veryfront components. */
export type ComponentProps = Record<string, unknown>;

/** React component that accepts generic Veryfront component props. */
export type Component<TProps extends object = ComponentProps> = React.ComponentType<TProps>;

/** Function-form React component used by runtime renderers. */
export type ComponentFunction<TProps extends object = ComponentProps> = (
  props: TProps,
) => React.ReactElement | null;

/** MDX component overrides keyed by component name. */
export type MDXComponents = Record<string, React.ElementType>;

/**
 * Parsed value accepted by public MDX frontmatter contracts.
 *
 * Runtime boundaries snapshot arrays and records before exposing them to
 * consumers. Parsed dates are retained as dates unless a specific output
 * boundary documents serialization.
 */
export type MDXFrontmatterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | MDXFrontmatterValue[]
  | { [key: string]: MDXFrontmatterValue };

/** Parsed frontmatter values from an MDX page. */
export interface MDXFrontmatter {
  /** Human-readable page title. */
  title?: string;
  /** Human-readable page summary. */
  description?: string;
  /** Layout reference or legacy boolean layout directive. */
  layout?: string | boolean;
  /** Provider selected for this page, when configured. */
  provider?: string;
  /** Tags attached to the page. */
  tags?: string | string[];
  /** Publication date as parsed from source frontmatter. */
  date?: string | Date;
  /** Whether the page is published. */
  published?: boolean;
  /** Page-specific ordering or provider priority. */
  priority?: number;
  /** Additional parsed frontmatter exposed to public consumers. */
  [key: string]: MDXFrontmatterValue | undefined;
}

/** Global values injected into a compiled MDX module. */
export interface MDXGlobals {
  /** Named global value. */
  [key: string]: unknown;
}

/** Runtime page context passed to page components. */
export interface PageContext {
  /** Route slug for the rendered page. */
  slug: string;
  /** Source or route path for the rendered page. */
  path: string;
  /** Parsed frontmatter for the rendered page. */
  frontmatter: MDXFrontmatter;
  /** Dynamic route parameters. */
  params?: Record<string, string>;
  /** URL query parameters. */
  query?: Record<string, string>;
}

/** Request and route data passed to application route functions. */
export interface RequestContext {
  /** Incoming HTTP request. */
  request: Request;
  /** Dynamic route parameters. */
  params?: Record<string, string>;
  /** URL query parameters. */
  query?: Record<string, string>;
  /** Request headers exposed to the route function. */
  headers?: Headers;
}

/** Value returned immediately or through a promise. */
export type MaybePromise<T> = T | Promise<T>;

/** Compiled MDX module data consumed by the rendering pipeline. */
export interface MdxBundle {
  /** Executable JavaScript generated from the MDX source. */
  compiledCode: string;
  /** Parsed frontmatter attached to the MDX source. */
  frontmatter?: MDXFrontmatter;
  /** Global values injected into the compiled module. */
  globals?: MDXGlobals;
}

/** Layout source and optional loaded representation. */
export interface LayoutItem {
  /** Layout source syntax. */
  kind: "mdx" | "tsx";
  /** Compiled MDX bundle for an MDX layout. */
  bundle?: MdxBundle;
  /** Loaded value for a script layout. */
  component?: React.ElementType;
  /** Resolved component module path. */
  componentPath?: string;
  /** Layout source path. */
  path?: string;
}

/** Compiled page bundle with render-time metadata. */
export interface PageBundle extends MdxBundle {
  /** Headings extracted from the page in source order. */
  headings?: Array<{ id: string; text: string; level: number }>;
  /** Compiler node metadata keyed by node index. */
  nodeMap?: Map<number, unknown>;
  /** Browser module code emitted for client components. */
  clientModuleCode?: string;
}

/** Exports accepted from a compiled MDX module. */
export interface MDXModule {
  /** Compiled MDX content component. */
  MDXContent?: React.ComponentType<{ components?: MDXComponents }>;
  /** Layout component exported by the MDX module. */
  MDXLayout?: React.ComponentType;
  /** Main layout component exported by the MDX module. */
  MainLayout?: React.ComponentType;
  /** Default component exported by the MDX module. */
  default?: React.ComponentType;
  /** Static metadata exported by the MDX module. */
  metadata?: Record<string, unknown>;
  /** Generates metadata for one page render. */
  generateMetadata?: (ctx: PageContext) => MaybePromise<Record<string, unknown>>;
}

/** Render value accepted from either script-page function export. */
export type ScriptPageOutput =
  | string
  | Response
  | {
    /** Rendered page HTML. */
    html: string;
    /** Frontmatter merged into the rendered page metadata. */
    frontmatter?: MDXFrontmatter;
    /** Legacy alias for returned page frontmatter. */
    meta?: MDXFrontmatter;
  }
  | Record<string, unknown>;

/** Exports accepted from a script-backed page module. */
export interface ScriptPageModule {
  /** Renders the page to HTML or an HTTP response. */
  render?: (ctx: PageContext) => MaybePromise<ScriptPageOutput>;
  /** Default page renderer or static HTML string. */
  default?: ((ctx: PageContext) => MaybePromise<ScriptPageOutput>) | string;
  /** Static HTML exported by the module. */
  html?: string;
  /** Generates metadata for one page render. */
  generateMetadata?: (ctx: PageContext) => MaybePromise<Record<string, unknown>>;
}

/** Metadata used to assemble the rendered HTML document. */
export interface RenderMetadata {
  /** Document title. */
  title?: string;
  /** Document description. */
  description?: string;
  /** Rendered route slug. */
  slug?: string;
  /** Page frontmatter. */
  frontmatter?: MDXFrontmatter;
  /** Active layout frontmatter. */
  layoutFrontmatter?: MDXFrontmatter;
  /** Active layout reference, or `false` when layouts are disabled. */
  layout?: string | false;
  /** Class name applied to the document body. */
  bodyClass?: string;
  /** Document language code. */
  lang?: string;
  /** Server-rendered content fingerprint. */
  ssrHash?: string;
}

/** Complete output returned by the page rendering pipeline. */
export interface RenderResult {
  /** Rendered HTML. */
  html: string;
  /** Rendered CSS. */
  css?: string;
  /** Page frontmatter used for the render. */
  frontmatter: MDXFrontmatter;
  /** Headings extracted from the rendered page. */
  headings?: Array<{ id: string; text: string; level: number }>;
  /** Compiler node metadata keyed by node index. */
  nodeMap?: Map<number, unknown>;
  /** Optional streaming response body. */
  stream?: ReadableStream | null;
  /** Browser page module emitted for hydration. */
  pageModule?: {
    slug: string;
    code: string;
    type: "mdx" | "component";
  };
  /** Server-rendered content fingerprint. */
  ssrHash?: string;
}
