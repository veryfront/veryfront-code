import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CollectedHead } from "#veryfront/react/head-collector.ts";
import type { EntityInfo, LayoutItem, MdxBundle, PageBundle } from "#veryfront/types";
import type { RenderOptions } from "./types.ts";

export interface HTMLGeneratorConfig {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
  /** Whether project filesystem URLs are trusted for browser access. */
  isLocalProject?: boolean;
}

export interface HTMLGenerationContext {
  html: string;
  pageInfo: EntityInfo;
  pageBundle: PageBundle;
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
  collectedMetadata: Record<string, unknown>;
  slug: string;
  ssrHash: string;
  options?: RenderOptions;
  collectedHead?: CollectedHead;
  /** Absolute paths to CSS files imported by components (collected during module loading) */
  cssImports?: string[];
}
