export interface SSROptions {
  /** React version used to select an isolated server renderer module. */
  reactVersion?: string;
  /**
   * Realm-local React and ReactDOM modules from one prepared graph. An explicit
   * pair bypasses the version cache and must match reactVersion when provided.
   * The version cache remains the default when this field is omitted.
   */
  reactRuntime?: import("./server-loader.ts").ReactServerRuntime;
  onError?: (error: Error) => void;
  bootstrapScripts?: string[];
  bootstrapModules?: string[];
  identifierPrefix?: string;
  namespaceURI?: string;
  nonce?: string;
  /** @internal Request-owned capabilities propagated through React Suspense. */
  renderContext?: import("../../server-render-context.ts").ServerRenderContextValue;
  progressiveChunkSize?: number;
  /** Maximum UTF-8 bytes retained when an SSR result must be buffered. */
  maxBufferedBytes?: number;
  onAllReady?: () => void;
  onShellReady?: () => void;
  onShellError?: (error: Error) => void;
}

export interface SSRResult {
  html?: string;
  stream?: ReadableStream<Uint8Array>;
  pipe?: (writable: NodeJS.WritableStream) => void;
  abort?: () => void;
  allReady?: Promise<unknown>;
}

export interface SSRResponseOptions extends SSROptions {
  headers?: Headers;
  title?: string;
  meta?: Record<string, string>;
  links?: Array<{ rel: string; href: string }>;
  scripts?: Array<{ src: string; type?: string }>;
}

export interface HTMLWrapOptions {
  title: string;
  meta: Record<string, string>;
  links: Array<{ rel: string; href: string }>;
  scripts: Array<{ src: string; type?: string }>;
  bootstrapScripts: string[];
  bootstrapModules?: string[];
  nonce?: string;
}
