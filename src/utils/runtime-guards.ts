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
  try {
    if (!isObject(global) || !("Deno" in global)) return false;
    const denoObj = global.Deno as GlobalWithDeno["Deno"];
    return typeof denoObj?.env?.get === "function";
  } catch {
    return false;
  }
}

/** Check whether node process is present. */
export function hasNodeProcess(global: unknown): global is GlobalWithProcess {
  try {
    if (!isObject(global) || !("process" in global)) return false;
    const processObj = global.process as GlobalWithProcess["process"];
    return isObject(processObj?.env);
  } catch {
    return false;
  }
}

/** Check whether Bun runtime is present. */
export function hasBunRuntime(global: unknown): global is GlobalWithBun {
  try {
    if (!isObject(global) || !("Bun" in global)) return false;
    return isObject(global.Bun) && typeof global.Bun.version === "string";
  } catch {
    return false;
  }
}
