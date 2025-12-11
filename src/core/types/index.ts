import type * as React from "react";
import type { EntityInfo } from "./entities.ts";

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
  MiddlewareFunction as ServerMiddlewareFunction,
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

export { brandValue, isBrandedString, unbrandValue } from "./branded.ts";

export type ComponentProps = Record<string, unknown>;
export type Component = React.ComponentType<ComponentProps>;
export type ComponentFunction = (props: ComponentProps) => React.ReactElement | null;

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

export interface Plugin {
  name: string;
  setup?: (build: unknown) => void | Promise<void>;
  transform?: (
    code: string,
    id: string,
  ) => { code: string } | null | Promise<{ code: string } | null>;
}

export interface ErrorInfo {
  message: string;
  stack?: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface CacheEntry<T = unknown> {
  value: T;
  ttl?: number;
  timestamp?: number;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  open?: boolean;
  mode?: "development" | "production";
}

export interface Route {
  path: string;
  component?: string;
  loader?: string;
  layout?: string;
  params?: Record<string, string>;
}

export type NextFunction = () => void | Promise<void>;
export type MiddlewareFunction = (ctx: RequestContext, next: NextFunction) => void | Promise<void>;

export type Awaitable<T> = T | Promise<T>;
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

export interface ProviderItem {
  kind: "mdx" | "tsx";
  bundle?: MdxBundle;
  component?: React.ComponentType | unknown;
  componentPath?: string;
  path?: string;
  entityInfo: EntityInfo;
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

export interface BrowserTargets {
  chrome?: number;
  firefox?: number;
  safari?: number;
  edge?: number;
}

export interface LightningCSSTransformOptions {
  filename: string;
  code: Uint8Array;
  minify?: boolean;
  sourceMap?: boolean;
  targets?: BrowserTargets;
  analyzeDependencies?: boolean;
}

export interface LightningCSSTransformResult {
  code: Uint8Array;
  map?: Uint8Array | void;
}

export interface LightningCSSModule {
  transform: (options: LightningCSSTransformOptions) => LightningCSSTransformResult;
  default?: unknown;
}

export interface CSSOptimizationOptions {
  enabled?: boolean;
  minify?: boolean;
  autoprefixer?: boolean;
  purge?: boolean;
  criticalCSS?: boolean;
  inputFiles?: string[];
  inputDir?: string;
  outputDir?: string;
  browsers?: string[];
  purgeContent?: string[];
  sourceMap?: boolean;
}

export interface CSSBundle {
  file: string;
  content: string;
  sourceMap?: string;
  size: number;
  minifiedSize: number;
  savings: number;
}

export interface CriticalCSSResult {
  critical: string;
  remaining: string;
  criticalSize: number;
  remainingSize: number;
}

export interface CSSProcessingResult {
  code: string;
  sourceMap?: string;
}

export interface CSSOptimizationStrategy {
  readonly name: string;
  readonly priority: number;
  canProcess(options: CSSOptimizationOptions): boolean;
  process(
    content: string,
    filename: string,
    options: CSSOptimizationOptions,
  ): Promise<CSSProcessingResult>;
}

export interface SelectorExtractionResult {
  selectors: Set<string>;
  classes: string[];
  ids: string[];
  tags: string[];
}

export interface CSSOptimizerStats {
  totalFiles: number;
  originalSize: number;
  minifiedSize: number;
  totalSavings: number;
  averageSavings: number;
}

export {
  getEntityBySlug,
  getEntityInfo,
  getLayoutEntity,
  getProviderEntities,
} from "./entities/getEntityInfo.ts";
