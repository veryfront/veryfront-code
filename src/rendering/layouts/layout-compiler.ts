import { computeHash, rendererLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import { compileMDXLayouts } from "./utils/compiler.ts";

const log = logger.component("layout-compiler");

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

        const { componentPath } = item;

        if (componentPath) {
          try {
            const src = await this.adapter.fs.readFile(componentPath);
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
      log.debug("dep hash computation failed", e as Error);
      return "";
    }
  }
}
