import type { ShellAdapter } from "../base.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export class NodeBasedShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    try {
      const fs = require("node:fs");
      const stat = fs.statSync(path);
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
      };
    } catch (error) {
      throw toError(createError({
        type: "file",
        message: `Failed to stat file: ${error}`,
      }));
    }
  }

  readFileSync(path: string): string {
    try {
      const fs = require("node:fs");
      return fs.readFileSync(path, "utf-8");
    } catch (error) {
      throw toError(createError({
        type: "file",
        message: `Failed to read file: ${error}`,
      }));
    }
  }
}
