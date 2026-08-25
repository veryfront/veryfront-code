/**
 * The browser surface the client hydration runtime touches.
 *
 * The runtime ships as a single esbuild bundle of the modules in this
 * directory. It is written against these structural types instead of the real
 * globals so the shipped functions are the same ones tests drive with stubs,
 * and so the `window.__veryfront*` contract the dev tooling, Studio embed and
 * HMR depend on is written down rather than implied.
 */

import type { HydrationDataStructure } from "../types.ts";

/** A page-data payload: the server-written hydration data plus SPA-only fields. */
export interface PageDataPayload extends Partial<HydrationDataStructure> {
  /** Per-route CSS injected on SPA navigation. */
  css?: string;
  /** `clear` means the release stylesheet is authoritative; drop injected CSS. */
  cssAction?: string;
  buildVersion?: BuildVersionSnapshot;
  redirect?: { destination?: string };
  /** Set when a server-owned layout means the route cannot render client-side. */
  requiresFullDocumentNavigation?: boolean;
  dependencyPinningCacheKey?: string;
}

export interface BuildVersionSnapshot {
  framework?: string;
  serverStart?: number;
  projectUpdated?: string;
}

export interface RouteTimingEntry {
  phase: string;
  path: string;
  duration: number;
  timestamp: number;
  [detail: string]: unknown;
}

export interface ClientRouter {
  domain: string;
  path: string;
  pathname: string;
  query: Record<string, string>;
  params: Record<string, string>;
  isPreview: boolean;
  isMounted: boolean;
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  forward(): void;
  prefetch(path: string): void;
  navigate(path: string): Promise<void>;
  reload(): void;
}

export interface ReactRoot {
  render(tree: unknown): void;
}

export interface RuntimeElement {
  tagName?: string;
  style: Record<string, string>;
  id: string;
  textContent: string | null;
  target: string;
  nonce?: string;
  innerHTML: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  prepend(node: unknown): void;
  appendChild(node: unknown): void;
  remove(): void;
  contains(other: unknown): boolean;
  closest(selector: string): RuntimeElement | null;
  scrollIntoView(options?: { behavior?: string }): void;
  /** React attaches the root here so re-renders reuse it instead of remounting. */
  __reactRoot?: ReactRoot;
  firstElementChild?: RuntimeElement | null;
}

export interface RuntimeDocument {
  readyState: string;
  title: string;
  body: RuntimeElement;
  head: RuntimeElement;
  createElement(tagName: string): RuntimeElement;
  querySelector(selector: string): RuntimeElement | null;
  querySelectorAll(selector: string): Iterable<RuntimeElement>;
  getElementById(id: string): RuntimeElement | null;
  addEventListener(
    type: string,
    listener: (event: RuntimeEvent) => void,
    options?: boolean | { once?: boolean; capture?: boolean },
  ): void;
}

export interface RuntimeEvent {
  target: RuntimeElement | null;
  relatedTarget?: RuntimeElement | null;
  state?: { pageData?: PageDataPayload; scrollY?: number } | null;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault(): void;
}

export interface RuntimeLocation {
  readonly origin: string;
  pathname: string;
  readonly search: string;
  href: string;
  reload(): void;
  assign?(url: string): void;
  replace?(url: string): void;
}

export interface RuntimeHistory {
  pushState(state: unknown, unused: string, url?: string): void;
  replaceState(state: unknown, unused: string, url?: string): void;
  back(): void;
  forward(): void;
}

/**
 * The `window.__veryfront*` surface. Every entry is a cross-bundle contract:
 * the module loader, Studio embed, HMR client and dev tooling read or write
 * these, so they stay on `window` even though the runtime is now modular.
 */
export interface VeryfrontWindowGlobals {
  __VERYFRONT_DEBUG__?: boolean;
  __veryfrontRouter?: ClientRouter;
  __veryfrontRouteTimings?: RouteTimingEntry[];
  __veryfrontHydrationComplete?: () => void;
  __veryfrontHydrationFailed?: (error: unknown) => void;
  __veryfrontRenderPage?: (pathname: string) => Promise<void>;
  __veryfrontClearComponentCache?: (path?: string) => void;
  __veryfrontSetStudioEmbed?: (value: boolean) => void;
  __veryfrontStudioEmbed?: boolean;
  __veryfrontSetReleaseId?: (value: string | null) => void;
  __veryfrontReleaseId?: string | null;
  __veryfrontSetReleaseAssetModules?: (value: Record<string, string> | null) => void;
  __veryfrontReleaseAssetModules?: Record<string, string> | null;
  __veryfrontSetHMRRefreshTimestamp?: (timestamp: string | null) => void;
  __veryfrontHMRRefreshTimestamp?: string | null;
  useRouter?: () => unknown;
}

export interface RuntimeWindow extends VeryfrontWindowGlobals {
  location: RuntimeLocation;
  history: RuntimeHistory;
  scrollY: number;
  addEventListener(
    type: string,
    listener: (event: RuntimeEvent) => void | Promise<void>,
    options?: boolean | { once?: boolean; capture?: boolean },
  ): void;
  dispatchEvent(event: unknown): boolean;
  scrollTo(x: number, y: number): void;
}

/** The subset of React the runtime uses, so a stub can stand in for it. */
export type ReactComponentClass = new (props: Record<string, unknown>) => {
  props: Record<string, unknown>;
  state: Record<string, unknown>;
  setState(next: Record<string, unknown>): void;
};

export interface ReactLike {
  createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  isValidElement(value: unknown): boolean;
  Children: { toArray(children: unknown): unknown[] };
  Component: ReactComponentClass;
}

/** Everything the runtime needs from outside its own modules. */
export interface HydrationRuntimeEnv {
  window: RuntimeWindow;
  document: RuntimeDocument;
  fetch: (url: string, init?: RuntimeFetchInit) => Promise<RuntimeResponse>;
  React: ReactLike;
  RouterProvider: unknown;
  PageContextProvider: unknown;
  createRoot: (container: unknown) => ReactRoot;
  /** Dynamic `import()`, injected so tests can resolve module URLs themselves. */
  importModule: (moduleUrl: string) => Promise<ModuleNamespace>;
  useRouterFromModule: () => unknown;
  /** Injected so a test can run the router without leaving live timers behind. */
  setTimeout: (handler: () => void, timeout?: number) => number;
  clearTimeout: (id: number) => void;
}

export interface RuntimeFetchInit {
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
  cache?: string;
}

export interface RuntimeResponse {
  ok: boolean;
  status: number;
  url?: string;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text?(): Promise<string>;
  clone?(): RuntimeResponse;
}

/** A loaded page/layout module. `default` is the component in the common case. */
export interface ModuleNamespace {
  default?: unknown;
  MDXLayout?: unknown;
  MainLayout?: unknown;
  [name: string]: unknown;
}
