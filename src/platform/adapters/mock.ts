import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type { RuntimeAdapter } from "./base.ts";

export interface MockRuntimeAdapter extends RuntimeAdapter {
  fs: RuntimeAdapter["fs"] & {
    files: Map<string, string>;
    directories: Set<string>;
  };
}

/**
 * Mock RuntimeAdapter for testing
 *
 * Provides an in-memory filesystem and environment for unit testing.
 * This adapter is useful for testing code that depends on the filesystem
 * without requiring actual file I/O.
 *
 * @example
 * ```typescript
 * const adapter = createMockAdapter();
 * adapter.fs.files.set("/project/pages/index.tsx", "export default () => <div>Home</div>");
 * const content = await adapter.fs.readFile("/project/pages/index.tsx");
 * ```
 */

/**
 * Creates a mock RuntimeAdapter for testing
 *
 * The mock adapter uses in-memory Map and Set for file storage:
 * - `files`: Map<string, string> for file contents
 * - `directories`: Set<string> for tracking directories
 * - `envVars`: Map<string, string> for environment variables
 */
export function createMockAdapter(): MockRuntimeAdapter {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const envVars = new Map<string, string>();

  return {
    name: "mock",
    platform: "deno" as const,
    serve: (_handler, _options) => {
      return Promise.resolve({
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 8000 },
      });
    },
    fs: {
      files, // Expose files Map for tests to populate
      directories, // Expose directories Set for tests to track empty dirs
      readFile: (path: string) => {
        const content = files.get(path);
        if (!content) {
          throw toError(createError({
            type: "file",
            message: `File not found: ${path}`,
          }));
        }
        return Promise.resolve(content);
      },
      writeFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      },
      exists: async (path: string) => {
        // Check for exact file match in virtual filesystem
        if (files.has(path)) return true;
        // Check if path is explicitly added as a directory
        if (directories.has(path)) return true;
        // Check if path is a directory (has child files) in virtual filesystem
        for (const filePath of files.keys()) {
          if (filePath.startsWith(path + "/")) return true;
        }
        // Fall back to checking real filesystem for temp files
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
      readDir: async function* (path: string) {
        const entries = new Map<string, { isFile: boolean; isDirectory: boolean }>();

        // Find all files under this directory
        for (const filePath of files.keys()) {
          if (filePath.startsWith(path + "/")) {
            const relativePath = filePath.slice(path.length + 1);
            const parts = relativePath.split("/");
            const name = parts[0]!;

            if (!entries.has(name)) {
              entries.set(name, {
                isFile: parts.length === 1,
                isDirectory: parts.length > 1,
              });
            }
          }
        }

        for (const [name, meta] of entries.entries()) {
          yield { name, ...meta, isSymlink: false };
        }
      },
      stat: (path: string) => {
        // Check if it's a file
        if (files.has(path)) {
          const content = files.get(path)!;
          return Promise.resolve({
            size: content.length,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
        }

        // Check if it's a directory
        if (directories.has(path)) {
          return Promise.resolve({
            size: 0,
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            mtime: new Date(),
          });
        }

        // Check if it's a directory with files
        for (const filePath of files.keys()) {
          if (filePath.startsWith(path + "/")) {
            return Promise.resolve({
              size: 0,
              isFile: false,
              isDirectory: true,
              isSymlink: false,
              mtime: new Date(),
            });
          }
        }

        return Promise.reject(new Error(`Path not found: ${path}`));
      },
      mkdir: (_path: string) => Promise.resolve(),
      remove: (_path: string) => Promise.resolve(),
      makeTempDir: (prefix: string) =>
        Promise.resolve(`/tmp/${prefix}-${Math.random().toString(36).slice(2)}`),
      watch: () => ({
        async *[Symbol.asyncIterator]() {
          yield { kind: "any", paths: [] };
        },
        close: () => {},
      }),
    },
    env: {
      get: (key: string) => envVars.get(key),
      set: (key: string, value: string) => envVars.set(key, value),
      toObject: () => Object.fromEntries(envVars),
    },
    server: {
      upgradeWebSocket: (_request) => {
        throw new Error("WebSocket upgrade not implemented in mock adapter");
      },
    },
    features: {
      websocket: false,
      http2: false,
      workers: false,
      jsx: false,
      typescript: false,
    },
  };
}
