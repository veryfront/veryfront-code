import { NotSupportedError } from "@veryfront/errors";
import type { ShellAdapter } from "../base.ts";

export class CloudflareShellAdapter implements ShellAdapter {
  statSync(_path: string): { isFile: boolean; isDirectory: boolean } {
    throw new NotSupportedError(
      "Synchronous file operations not supported in Cloudflare Workers",
      { platform: "cloudflare", operation: "statSync" },
    );
  }

  readFileSync(_path: string): string {
    throw new NotSupportedError(
      "Synchronous file operations not supported in Cloudflare Workers",
      { platform: "cloudflare", operation: "readFileSync" },
    );
  }
}
