import type { EnvironmentAdapter } from "../../base.ts";
import { env as getEnvObject, getEnv, setEnv } from "../../../compat/process.ts";

export class DenoEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return getEnv(key);
  }

  set(key: string, value: string): void {
    setEnv(key, value);
  }

  toObject(): Record<string, string> {
    return getEnvObject();
  }
}
