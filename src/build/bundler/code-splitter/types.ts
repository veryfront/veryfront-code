import type { Metafile } from "esbuild";

export type MetafileOutput = Metafile["outputs"][string];

export interface SplitOptions {
  projectDir: string;
  outDir: string;
  mode: "development" | "production";
  routes: {
    path: string;
    file: string;
    name?: string;
  }[];
  shared?: string[];
  external?: string[];
  moduleResolution?: "cdn" | "self-hosted" | "bundled";
}

export interface SplitResult {
  entries: Map<string, ChunkInfo>;
  shared: Map<string, ChunkInfo>;
  manifest: ChunkManifest;
}

export interface ChunkInfo {
  name: string;
  file: string;
  imports: string[];
  css?: string;
  size: number;
  hash: string;
}

export interface ChunkManifest {
  version: string;
  routes: Record<string, RouteChunkInfo>;
  chunks: Record<string, ChunkInfo>;
  shared: string[];
}

export interface RouteChunkInfo {
  entry: string;
  chunks: string[];
  css?: string[];
  preload?: string[];
}
