import type { ShellAdapter } from "../../base.ts";
import * as fs from "node:fs";

export class NodeBasedShellAdapter implements ShellAdapter {
  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    const stat = fs.statSync(path);
    return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
  }

  readFileSync(path: string): string {
    return fs.readFileSync(path, "utf-8");
  }
}
