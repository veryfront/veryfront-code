/**
 * Renderer Factory Types
 * @module server/shared/renderer/types
 */

import type { createRenderer } from "@veryfront/rendering/index.ts";
import type { RendererAdapter } from "./universal-adapter.ts";

/** Renderer instance type from createRenderer */
export type RendererInstance = Awaited<ReturnType<typeof createRenderer>>;

/** Union type for any renderer (full or adapter) */
export type AnyRenderer = RendererInstance | RendererAdapter;

/** Promise that resolves to a renderer instance */
export type RendererPromise = Promise<RendererInstance>;

/** Promise that resolves to any renderer type */
export type AnyRendererPromise = Promise<AnyRenderer>;

/** Cached renderer entry with metadata */
export interface CachedRenderer {
  renderer: RendererInstance;
  promise: RendererPromise;
  projectSlug: string;
  lastAccess: number;
  createdAt: number;
}
