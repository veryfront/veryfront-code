import type { ShellAdapter } from "../../base.ts";
import * as fs from "node:fs";
import { createFileOperationError } from "./filesystem-errors.ts";

export class NodeBasedShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    try {
      const stat = fs.statSync(path);
      return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
    } catch (error) {
      throw createFileOperationError(error, "stat");
    }
  }

  readFileSync(path: string): string {
    try {
      return fs.readFileSync(path, "utf-8");
    } catch (error) {
      throw createFileOperationError(error, "read");
    }
  }
}
