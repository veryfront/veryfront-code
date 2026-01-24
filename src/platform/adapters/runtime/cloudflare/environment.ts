import type { EnvironmentAdapter } from "../../base.ts";
import type { CloudflareEnv } from "./types.ts";

export class CloudflareEnvironmentAdapter implements EnvironmentAdapter {
  constructor(private env: CloudflareEnv) {}

  get(key: string): string | undefined {
    const value = this.env[key];
    if (typeof value !== "string") return undefined;
    return value;
  }

  set(key: string, value: string): void {
    this.env[key] = value;
  }

  toObject(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(this.env)) {
      if (typeof value !== "string") continue;
      result[key] = value;
    }

    return result;
  }
}
