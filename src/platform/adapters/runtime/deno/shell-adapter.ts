import type { ShellAdapter } from "../../base.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

function assertDenoRuntime(method: string): void {
  if (typeof Deno === "undefined") {
    throw NOT_SUPPORTED.create({
      detail: `DenoShellAdapter.${method}() can only be used in Deno runtime`,
    });
  }
}

export class DenoShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    assertDenoRuntime("statSync");
    try {
      const stat = Deno.statSync(path);
      return { isFile: stat.isFile, isDirectory: stat.isDirectory };
    } catch (error) {
      throw toError(
        createError({
          type: "file",
          message: `Failed to stat file: ${error}`,
        }),
      );
    }
  }

  readFileSync(path: string): string {
    assertDenoRuntime("readFileSync");
    try {
      return Deno.readTextFileSync(path);
    } catch (error) {
      throw toError(
        createError({
          type: "file",
          message: `Failed to read file: ${error}`,
        }),
      );
    }
  }
}
