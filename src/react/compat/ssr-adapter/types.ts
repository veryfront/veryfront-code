export interface SSROptions {
  onError?: (error: Error) => void;
  bootstrapScripts?: string[];
  bootstrapModules?: string[];
  identifierPrefix?: string;
  namespaceURI?: string;
  nonce?: string;
  progressiveChunkSize?: number;
  onAllReady?: () => void;
  onShellReady?: () => void;
  onShellError?: (error: Error) => void;
}

export interface SSRResult {
  html?: string;
  stream?: ReadableStream;
  pipe?: (writable: NodeJS.WritableStream) => void;
  abort?: () => void;
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
  nonce?: string;
}
