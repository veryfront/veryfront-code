/** Serializable node in a React Server Components render tree. */
export interface RSCNode {
  /** Node role in the server-rendered tree. */
  type: "server" | "client" | "html" | "fragment";
  /** Component identifier for server and client nodes. */
  component?: string;
  /** Serializable props supplied to the component. */
  props?: Record<string, unknown>;
  /** Ordered child nodes. */
  children?: RSCNode[];
  /** Pre-rendered HTML for an HTML node. */
  html?: string;
  /** Unescaped text used by recursive client-boundary payloads. */
  text?: string;
}

/** Versioned child-node payload embedded at a client component boundary. */
export interface RSCChildrenPayload {
  /** Child payload format version. */
  version: 1;
  /** Ordered child nodes. */
  nodes: RSCNode[];
}

/** Serialized result of rendering a React Server Components request. */
export interface RSCPayload {
  /** Server-rendered HTML. */
  html: string;
  /** Browser module paths keyed by client component identifier. */
  clientRefs: Record<string, string>;
  /** Stylesheets and scripts required by the payload. */
  assets?: {
    /** Stylesheet URLs required by the payload. */
    css?: string[];
    /** Script URLs required by the payload. */
    js?: string[];
  };
  /** Optional structured render tree. */
  tree?: RSCNode;
}

/** Manifest metadata for one client component. */
export interface ClientComponentMeta {
  /** Stable client component identifier. */
  id: string;
  /** Browser-loadable module path. */
  path: string;
  /** Absolute source path, exposed only to local hydration manifests. */
  sourcePath?: string;
  /** Project-relative source path used by remote client module endpoints. */
  rel?: string;
  /** Source-content fingerprint used to invalidate browser module identity. */
  contentHash?: string;
  /** Named exports available from the component module. */
  exports: string[];
}

/** Options used to create the React Server Components renderer. */
export interface RSCRendererOptions {
  /** Client component metadata keyed by component identifier. */
  clientManifest: Map<string, ClientComponentMeta>;
  /** Absolute directory of the rendered project. */
  projectDir: string;
  /** Optimization mode used for the render. */
  mode?: "development" | "production";
  /** Strategy used to resolve browser client modules. */
  clientModuleStrategy?: "fs" | "rsc-module";
  /** React version used to select the matching server renderer module. */
  reactVersion?: string;
}

/** Classification assigned to a React component source module. */
export type ComponentType = "server" | "client" | "unknown";

/** Static analysis result for one React component source module. */
export interface ComponentAnalysis {
  /** Inferred component classification. */
  type: ComponentType;
  /** Absolute source file path. */
  filePath: string;
  /** Named exports found in the source module. */
  exports: string[];
  /** Stable component identifier. */
  id: string;
  /** Source-content fingerprint. */
  contentHash: string;
  /** Whether the module declares the `use client` directive. */
  hasUseClient: boolean;
  /** Whether the module declares the `use server` directive. */
  hasUseServer: boolean;
}
