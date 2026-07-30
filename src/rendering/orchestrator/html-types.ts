import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CollectedHead } from "#veryfront/react/head-collector.ts";
import type { EntityInfo, LayoutItem, MdxBundle, PageBundle } from "#veryfront/types";
import type { RenderOptions } from "./types.ts";
import type { LayoutRequestIdentity } from "./layout.ts";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";

export interface HTMLGeneratorConfig {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
  /** Whether project filesystem URLs are trusted for browser access. */
  isLocalProject?: boolean;
  /** Exact browser module transport authorized for generated HTML. */
  clientModuleStrategy?: ClientModuleStrategy;
}

export interface HTMLGenerationContext {
  html: string;
  pageInfo: EntityInfo;
  pageBundle: PageBundle;
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
  /**
   * Exact project/import-map identity captured while the route layouts were
   * preloaded. SSR error-boundary rendering must reuse this identity rather
   * than resolving mutable project state a second time.
   */
  layoutRequestIdentity?: LayoutRequestIdentity;
  /** Per-layout request data reused when an SSR error boundary replaces the page. */
  layoutDataMap?: Map<string, Record<string, unknown>>;
  collectedMetadata: Record<string, unknown>;
  slug: string;
  ssrHash: string;
  options?: RenderOptions;
  collectedHead?: CollectedHead;
  /** Absolute paths to CSS files imported by components (collected during module loading) */
  cssImports?: string[];
}
