import type { ClientComponentMeta } from "../../../../../rendering/rsc/types.js";

export interface ManifestData {
  components: Record<string, string>;
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
