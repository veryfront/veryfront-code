/**
 * Shared Orchestrator Types
 *
 * Location: src/render/orchestrator/types.ts (formerly src/render/core/renderer/types.ts)
 */

import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { MDXFrontmatter } from "@veryfront/types";

export interface RendererOptions {
  projectDir: string;
  mode: "development" | "production";
  port?: number;
  adapter?: RuntimeAdapter;
  moduleServerUrl?: string;
  directories?: {
    app?: string;
    pages?: string;
    components?: string[];
  };
}

export interface RenderResult {
  html: string;
  css?: string;
  frontmatter: MDXFrontmatter;
  headings?: Array<{ id: string; text: string; level: number }>;
  nodeMap?: Map<number, unknown>;
  stream?: ReadableStream | null;
  pageModule?: {
    slug: string;
    code: string;
    type: "mdx" | "component";
  };
  ssrHash?: string;
}

export interface RenderOptions {
  params?: Record<string, string | string[]>;
  props?: Record<string, unknown>;
  delivery?: "string" | "stream";
  request?: Request;
  url?: URL;
  nonce?: string;
}

export interface RenderContext {
  slug: string;
  options?: RenderOptions;
}
