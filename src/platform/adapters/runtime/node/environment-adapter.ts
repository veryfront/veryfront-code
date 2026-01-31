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
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value == null) continue;
      result[key] = value;
    }

    return result;
  }
}
