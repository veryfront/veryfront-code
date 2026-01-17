/**
 * Shim for Deno.env in Node.js environment
 * This file is injected by esbuild to provide Deno.env compatibility
 */

// @ts-ignore - Global Deno shim for Node.js
globalThis.Deno = globalThis.Deno || {
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
