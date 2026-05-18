/** Public API contract for global with Deno. */
export interface GlobalWithDeno {
  Deno?: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

/** Public API contract for global with process. */
export interface GlobalWithProcess {
  process?: {
    env: Record<string, string | undefined>;
    version?: string;
    versions?: Record<string, string>;
  };
}

/** Public API contract for global with Bun. */
export interface GlobalWithBun {
  Bun?: {
    version: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Check whether Deno runtime is present. */
export function hasDenoRuntime(global: unknown): global is GlobalWithDeno {
  if (!isObject(global) || !("Deno" in global)) return false;
  const denoObj = global.Deno as GlobalWithDeno["Deno"];
  return typeof denoObj?.env?.get === "function";
}

/** Check whether node process is present. */
export function hasNodeProcess(global: unknown): global is GlobalWithProcess {
  if (!isObject(global) || !("process" in global)) return false;
  const processObj = global.process as GlobalWithProcess["process"];
  return typeof processObj?.env === "object";
}

/** Check whether Bun runtime is present. */
export function hasBunRuntime(global: unknown): global is GlobalWithBun {
  if (!isObject(global) || !("Bun" in global)) return false;
  return global.Bun !== undefined;
}
