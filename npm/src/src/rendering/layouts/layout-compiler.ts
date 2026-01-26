import { computeHash, rendererLogger as logger } from "../../utils/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle } from "../../types/index.js";
import { compileMDXLayouts } from "./utils/compiler.js";

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
    try {
      const depParts: string[] = [];

      if (layoutBundle) {
        depParts.push(await computeHash(String(layoutBundle.compiledCode ?? "")));
      }

      for (const item of nestedLayouts) {
        if (!item) continue;

        if (item.componentPath) {
          try {
            const src = await this.adapter.fs.readFile(item.componentPath);
            depParts.push(await computeHash(src));
          } catch (e) {
            logger.debug(
              "[LayoutCompiler] reading tsx layout for dep hash failed",
              e as Error,
            );
          }
          continue;
        }

        const compiledCode = item.bundle?.compiledCode;
        if (compiledCode) {
          depParts.push(await computeHash(String(compiledCode)));
        }
      }

      return depParts.join(":");
    } catch (e) {
      logger.debug("[LayoutCompiler] dep hash computation failed", e as Error);
      return "";
    }
  }
}
