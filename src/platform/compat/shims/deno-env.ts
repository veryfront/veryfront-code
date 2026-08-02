import process from "node:process";

export type DenoEnvShim = {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  };
};

type DenoEnvShimGlobal = Omit<typeof globalThis, "Deno"> & {
  Deno?: DenoEnvShim;
};

const global = globalThis as DenoEnvShimGlobal;

/** @internal Builds the environment facade without mutating runtime globals. */
export function createDenoEnvShim(
  env: Record<string, string | undefined>,
): DenoEnvShim["env"] {
  return {
    get(key: string): string | undefined {
      return env[key];
    },
    set(key: string, value: string): void {
      env[key] = value;
    },
    delete(key: string): void {
      delete env[key];
    },
    has(key: string): boolean {
      return env[key] !== undefined;
    },
    toObject(): Record<string, string> {
      return Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    },
  };
}

global.Deno ??= {
  env: createDenoEnvShim(process.env),
};
