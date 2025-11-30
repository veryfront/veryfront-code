/**
 * Compiler Service - Handles delayed initialization of compilation functions
 * to avoid circular dependencies.
 */

import type { MdxBundle } from "@veryfront/types";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export type CompileMDXFunction = (
  content: string,
  frontmatter?: Record<string, unknown>,
  filePath?: string,
) => Promise<MdxBundle>;

/**
 * Service that holds the compiler function reference.
 * Allows components to be initialized before the compiler is ready,
 * breaking circular dependencies between the compiler and components that use it.
 */
export class CompilerService {
  private _compileMDX: CompileMDXFunction | null = null;

  /**
   * Set the compile function
   */
  setCompileMDX(fn: CompileMDXFunction): void {
    this._compileMDX = fn;
  }

  /**
   * Execute the compile function
   */
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
    return await this._compileMDX(content, frontmatter, filePath);
  }

  /**
   * Get the underlying function (if needed for direct passing)
   */
  getCompileFunction(): CompileMDXFunction {
    return this.compileMDX.bind(this);
  }
}
