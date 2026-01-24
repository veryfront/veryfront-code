import type { MdxBundle } from "#veryfront/types";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export type CompileMDXFunction = (
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
) => Promise<MdxBundle>;

export class CompilerService {
  private _compileMDX: CompileMDXFunction | null = null;

  setCompileMDX(fn: CompileMDXFunction): void {
    this._compileMDX = fn;
  }

  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle> {
    const compile = this._compileMDX;
    if (!compile) {
      throw toError(
        createError({
          type: "render",
          message: "CompilerService: compileMDX not initialized",
        }),
      );
    }

    return compile(content, frontmatter, filePath);
  }

  getCompileFunction(): CompileMDXFunction {
    return this.compileMDX.bind(this);
  }
}
