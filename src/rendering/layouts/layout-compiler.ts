/**
 * Layout Compiler - Compiles MDX layouts and computes dependency hashes
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { getContentHash } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import { compileMDXLayouts } from "./utils/compiler.ts";
import { withFallback } from "@veryfront/platform/adapters/index.ts";

export interface LayoutCompilerOptions {
  adapter: RuntimeAdapter;
  compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;
}

/**
 * LayoutCompiler handles compilation of MDX layouts and dependency hash computation
 */
export class LayoutCompiler {
  private adapter: RuntimeAdapter;
  private compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;

  constructor(options: LayoutCompilerOptions) {
    this.adapter = options.adapter;
    this.compileMDX = options.compileMDX;
  }

  /**
   * Compile all MDX layouts in the layout items array
   */
  async compileLayouts(layouts: LayoutItem[]): Promise<void> {
    await compileMDXLayouts(layouts, this.compileMDX, this.adapter);
  }

  /**
   * Compute dependency hash for persistent cache
   * Includes hashes of layout bundles, nested layouts, and providers
   */
  async computeDependencyHash(
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    providerInfos: EntityInfo[],
  ): Promise<string> {
    let depsHash = "";

    try {
      const depParts: string[] = [];

      // Named layout
      if (layoutBundle) {
        const code = String(layoutBundle.compiledCode || "");
        depParts.push(await getContentHash(code));
      }

      // Nested layouts
      for (const item of nestedLayouts) {
        if (!item) continue;

        if (item.componentPath) {
          try {
            const src = await withFallback(
              () => this.adapter.fs.readFile(item.componentPath!),
              () => Deno.readTextFile(item.componentPath!),
              { operationName: "readFile:layoutCompiler:depHash", logError: false },
            );
            depParts.push(await getContentHash(src));
          } catch (e) {
            logger.debug("[LayoutCompiler] reading tsx layout for dep hash failed", e as Error);
          }
        } else if (item.bundle?.compiledCode) {
          depParts.push(await getContentHash(String(item.bundle.compiledCode)));
        }
      }

      // Providers
      for (const p of providerInfos) {
        try {
          depParts.push(await getContentHash(String(p.entity.content || "")));
        } catch (e) {
          logger.debug("[LayoutCompiler] provider dep hash read failed", e as Error);
        }
      }

      depsHash = depParts.length > 0 ? depParts.join(":") : "";
    } catch (e) {
      logger.debug("[LayoutCompiler] dep hash computation failed", e as Error);
    }

    return depsHash;
  }
}
