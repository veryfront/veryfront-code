export interface GlobalWithDeno {
  Deno?: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

export interface GlobalWithProcess {
  process?: {
    env: Record<string, string | undefined>;
    version?: string;
    versions?: Record<string, string>;
  };
}

export interface GlobalWithBun {
  Bun?: {
    version: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hasDenoRuntime(global: unknown): global is GlobalWithDeno {
  if (!isObject(global) || !("Deno" in global)) return false;
  return typeof (global as GlobalWithDeno).Deno?.env?.get === "function";
}

export function hasNodeProcess(global: unknown): global is GlobalWithProcess {
  if (!isObject(global) || !("process" in global)) return false;
  return typeof (global as GlobalWithProcess).process?.env === "object";
}

export function hasBunRuntime(global: unknown): global is GlobalWithBun {
  if (!isObject(global) || !("Bun" in global)) return false;
  return (global as GlobalWithBun).Bun !== undefined;
}
