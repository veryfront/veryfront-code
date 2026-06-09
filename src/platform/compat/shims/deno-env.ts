type DenoEnvShim = {
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

global.Deno ??= {
  env: {
    get(key: string): string | undefined {
      return process.env[key];
    },
    set(key: string, value: string): void {
      process.env[key] = value;
    },
    delete(key: string): void {
      delete process.env[key];
    },
    has(key: string): boolean {
      return key in process.env;
    },
    toObject(): Record<string, string> {
      return { ...process.env } as Record<string, string>;
    },
  },
};
