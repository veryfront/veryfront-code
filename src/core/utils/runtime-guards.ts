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

export function hasDenoRuntime(global: unknown): global is GlobalWithDeno {
  return (
    typeof global === "object" &&
    global !== null &&
    "Deno" in global &&
    typeof (global as GlobalWithDeno).Deno?.env?.get === "function"
  );
}

export function hasNodeProcess(global: unknown): global is GlobalWithProcess {
  return (
    typeof global === "object" &&
    global !== null &&
    "process" in global &&
    typeof (global as GlobalWithProcess).process?.env === "object"
  );
}

export function hasBunRuntime(global: unknown): global is GlobalWithBun {
  return (
    typeof global === "object" &&
    global !== null &&
    "Bun" in global &&
    typeof (global as GlobalWithBun).Bun !== "undefined"
  );
}
