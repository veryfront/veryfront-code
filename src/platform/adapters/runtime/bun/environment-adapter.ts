import process from "node:process";
import type { EnvironmentAdapter } from "../../base.ts";
import { envToObject } from "../shared/env-to-object.ts";

export class BunEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return process.env[key];
  }

  set(key: string, value: string): void {
    process.env[key] = value;
  }

  toObject(): Record<string, string> {
    return envToObject(process.env);
  }
}
