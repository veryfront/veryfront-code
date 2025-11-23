import type { EnvironmentAdapter } from "../base.ts";

export class BunEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return Bun.env[key];
  }

  set(key: string, value: string): void {
    Bun.env[key] = value;
  }

  toObject(): Record<string, string> {
    return { ...Bun.env };
  }
}
