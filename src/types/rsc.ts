export interface RSCNode {
  type: "server" | "client" | "html" | "fragment";
  component?: string;
  props?: Record<string, unknown>;
  children?: RSCNode[];
  html?: string;
  /** Unescaped text used by recursive client-boundary payloads. */
  text?: string;
}

export interface RSCChildrenPayload {
  version: 1;
  nodes: RSCNode[];
}

export interface RSCPayload {
  html: string;
  clientRefs: Record<string, string>;
  assets?: {
    css?: string[];
    js?: string[];
  };
  tree?: RSCNode;
}

export interface ClientComponentMeta {
  id: string;
  path: string;
  /** Absolute source path, exposed only to local hydration manifests. */
  sourcePath?: string;
  /** Project-relative source path used by remote client module endpoints. */
  rel?: string;
  /** Source-content fingerprint used to invalidate browser module identity. */
  contentHash?: string;
  exports: string[];
}

export interface RSCRendererOptions {
  clientManifest: Map<string, ClientComponentMeta>;
  projectDir: string;
  mode?: "development" | "production";
  clientModuleStrategy?: "fs" | "rsc-module";
  /** React version used to select the matching server renderer module. */
  reactVersion?: string;
}

export type ComponentType = "server" | "client" | "unknown";

export interface ComponentAnalysis {
  type: ComponentType;
  filePath: string;
  exports: string[];
  id: string;
  contentHash: string;
  hasUseClient: boolean;
  hasUseServer: boolean;
}
