import type { MdxBundle } from "@veryfront/types";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

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

  async compileMDX(
    content: string,
    frontmatter?: Record<string, unknown>,
    filePath?: string,
  ): Promise<MdxBundle> {
    if (!this._compileMDX) {
      throw toError(createError({
        type: "render",
        message: "CompilerService: compileMDX not initialized",
      }));
    }
    return this._compileMDX(content, frontmatter, filePath);
  }

  getCompileFunction(): CompileMDXFunction {
    return this.compileMDX.bind(this);
  }
}
