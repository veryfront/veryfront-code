/**
 * Renderer Factory Types
 * @module server/shared/renderer/types
 */

import type { createRenderer } from "@veryfront/rendering/index.ts";

/** Renderer instance type from createRenderer */
export type RendererInstance = Awaited<ReturnType<typeof createRenderer>>;

/** Promise that resolves to a renderer instance */
export type RendererPromise = Promise<RendererInstance>;

/** Cached renderer entry with metadata */
export interface CachedRenderer {
  renderer: RendererInstance;
  promise: RendererPromise;
  projectSlug: string;
  lastAccess: number;
  createdAt: number;
}
