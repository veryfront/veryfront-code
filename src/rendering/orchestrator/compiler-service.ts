import type { MdxBundle } from "#veryfront/types";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export type CompileMDXFunction = (
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
) => Promise<MdxBundle>;

export class CompilerService {
  private compileFn: CompileMDXFunction | null = null;

  setCompileMDX(fn: CompileMDXFunction): void {
    this.compileFn = fn;
  }

  compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle> {
    if (!this.compileFn) {
      throw toError(
        createError({
          type: "render",
          message: "CompilerService: compileMDX not initialized",
        }),
      );
    }

    return this.compileFn(content, frontmatter, filePath);
  }

  getCompileFunction(): CompileMDXFunction {
    return this.compileMDX.bind(this);
  }
}
