import { NotSupportedError } from "#veryfront/errors";
import type { ShellAdapter } from "../../base.ts";

export class CloudflareShellAdapter implements ShellAdapter {
  private throwNotSupported(operation: "statSync" | "readFileSync"): never {
    throw new NotSupportedError(
      "Synchronous file operations not supported in Cloudflare Workers",
      { platform: "cloudflare", operation },
    );
  }

  statSync(_path: string): { isFile: boolean; isDirectory: boolean } {
    return this.throwNotSupported("statSync");
  }

  readFileSync(_path: string): string {
    return this.throwNotSupported("readFileSync");
  }
}
