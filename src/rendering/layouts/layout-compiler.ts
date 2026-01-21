import { rendererLogger as logger } from "#veryfront/utils";
import { getContentHash } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import { compileMDXLayouts } from "./utils/compiler.ts";

export interface LayoutCompilerOptions {
  adapter: RuntimeAdapter;
  compileMDX: (
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ) => Promise<MdxBundle>;
}

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

  async compileLayouts(layouts: LayoutItem[]): Promise<void> {
    await compileMDXLayouts(layouts, this.compileMDX, this.adapter);
  }

  async computeDependencyHash(
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
  ): Promise<string> {
    let depsHash = "";

    try {
      const depParts: string[] = [];

      if (layoutBundle) {
        const code = String(layoutBundle.compiledCode || "");
        depParts.push(await getContentHash(code));
      }

      for (const item of nestedLayouts) {
        if (!item) continue;

        if (item.componentPath) {
          try {
            const src = await this.adapter.fs.readFile(item.componentPath);
            depParts.push(await getContentHash(src));
          } catch (e) {
            logger.debug("[LayoutCompiler] reading tsx layout for dep hash failed", e as Error);
          }
        } else if (item.bundle?.compiledCode) {
          depParts.push(await getContentHash(String(item.bundle.compiledCode)));
        }
      }

      depsHash = depParts.join(":");
    } catch (e) {
      logger.debug("[LayoutCompiler] dep hash computation failed", e as Error);
    }

    return depsHash;
  }
}
