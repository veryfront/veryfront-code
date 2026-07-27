import type { EnvironmentAdapter } from "../../base.ts";
import type { CloudflareEnv } from "./types.ts";

export class CloudflareEnvironmentAdapter implements EnvironmentAdapter {
  private readonly base: Readonly<Record<string, string>>;
  private readonly overrides = new Map<string, string>();

  constructor(env: CloudflareEnv) {
    this.base = Object.freeze(
      Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    );
  }

  get(key: string): string | undefined {
    const override = this.overrides.get(key);
    if (override !== undefined) return override;
    return Object.hasOwn(this.base, key) ? this.base[key] : undefined;
  }

  set(key: string, value: string): void {
    this.overrides.set(key, value);
  }

  toObject(): Record<string, string> {
    return Object.fromEntries([
      ...Object.entries(this.base),
      ...this.overrides,
    ]);
  }
}
