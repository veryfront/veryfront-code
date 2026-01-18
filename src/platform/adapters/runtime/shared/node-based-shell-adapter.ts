import type { ShellAdapter } from "../../base.ts";
import { createError, toError } from "@veryfront/errors";
import * as fs from "node:fs";

export class NodeBasedShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    try {
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
      return fs.readFileSync(path, "utf-8");
    } catch (error) {
      throw toError(createError({
        type: "file",
        message: `Failed to read file: ${error}`,
      }));
    }
  }
}
