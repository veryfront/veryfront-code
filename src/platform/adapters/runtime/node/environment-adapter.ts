import process from "node:process";
import type { EnvironmentAdapter } from "../../base.ts";

export class NodeEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return process.env[key];
  }

  set(key: string, value: string): void {
    process.env[key] = value;
  }

  toObject(): Record<string, string> {
    return { ...process.env } as Record<string, string>;
  }
}
