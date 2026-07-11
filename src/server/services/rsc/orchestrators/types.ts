import type { ClientComponentMeta } from "#veryfront/rendering/rsc/types.ts";

export interface ManifestData {
  version: 1;
  hash: string;
  components: Record<string, string>;
  modules: Array<{ id: string; clientRef: string; exports: string[] }>;
  graphIds: {
    client: Array<{ id: string; path: string; rel: string }>;
    server: Array<{ id: string; path: string; rel: string }>;
  };
}

export interface ManifestCacheEntry {
  data: ManifestData;
  timestamp: number;
}

export interface RSCHandlerConfig {
  projectDir: string;
}

export interface RSCRendererConfig {
  clientManifest: Map<string, ClientComponentMeta>;
  projectDir: string;
  mode: "development" | "production";
}

export interface RenderProps extends Record<string, unknown> {
  params: Record<string, string>;
  searchParams: Record<string, string>;
}

export interface CacheOptions {
  isStatic: boolean;
  maxAge: number;
}

export interface StreamSlot {
  type: "slot";
  id: string;
  html: string;
}
