import type { ShellAdapter } from "../../base.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";

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
    const stat = Deno.statSync(path);
    return { isFile: stat.isFile, isDirectory: stat.isDirectory };
  }

  readFileSync(path: string): string {
    assertDenoRuntime("readFileSync");
    return Deno.readTextFileSync(path);
  }
}
