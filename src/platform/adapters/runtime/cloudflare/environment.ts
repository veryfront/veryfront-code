import type { EnvironmentAdapter } from "../../base.ts";
import type { CloudflareEnv } from "./types.ts";

export class CloudflareEnvironmentAdapter implements EnvironmentAdapter {
  private readonly overrides = new Map<string, string>();

  constructor(private readonly env: CloudflareEnv) {}

  get(key: string): string | undefined {
    const override = this.overrides.get(key);
    if (override !== undefined || this.overrides.has(key)) return override;
    const value = this.env[key];
    return typeof value === "string" ? value : undefined;
  }

  set(key: string, value: string): void {
    this.overrides.set(key, value);
  }

  toObject(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(this.env)) {
      if (typeof value === "string") result[key] = value;
    }
    for (const [key, value] of this.overrides) result[key] = value;

    return result;
  }
}
