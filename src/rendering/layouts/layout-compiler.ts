import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import { compileMDXLayouts } from "./utils/compiler.ts";
import { computeDepsHash } from "./utils/hash-calculator.ts";

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
    return await computeDepsHash(layoutBundle, nestedLayouts, this.adapter);
  }
}
