import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSecureFs, wrapAdapterWithSecurity } from "./secure-fs.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";
import type { RuntimeAdapter, ServeOptions, Server } from "#veryfront/platform/adapters/base.ts";

// Minimal adapter stub — only getUnsafeAdapter() is being tested
function createMockAdapter() {
  return { fs: {} } as any;
}

describe("SecureFs", () => {
  it("rejects unknown contexts instead of falling through to internal policy", () => {
    assertThrows(
      () =>
        createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
          context: "unknown" as never,
        }),
      VeryfrontError,
      "valid security context",
    );

    const secureFs = createSecureFs({
      baseDir: "/tmp",
      adapter: createMockAdapter(),
      context: "user-input",
    });
    assertThrows(
      () => secureFs.setContext("unknown" as never),
      VeryfrontError,
      "valid security context",
    );
  });

  it("rejects invalid runtime options instead of weakening validation", () => {
    for (
      const config of [
        { baseDir: "" },
        { context: null as unknown as "internal" },
        { contextOptions: null as never },
        {
          contextOptions: {
            allowedImportDirs: [""],
          },
        },
        { throwOnError: "false" as unknown as boolean },
        { onSecurityEvent: "noop" as unknown as () => void },
        {
          validationOptions: {
            level: "unknown" as never,
          },
        },
        {
          validationOptions: {
            allowAbsolute: "yes" as unknown as boolean,
          },
        },
      ]
    ) {
      assertThrows(
        () =>
          createSecureFs({
            baseDir: "/tmp",
            adapter: createMockAdapter(),
            ...config,
          }),
        VeryfrontError,
        "SecureFs",
      );
    }
  });

  it("rejects a missing write target beneath a symlinked parent", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsideFile = `${outsideDir}/escaped.txt`;
    try {
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      await assertRejects(
        () => secureFs.writeFile("link/escaped.txt", "blocked"),
        VeryfrontError,
        "outside base directory",
      );

      let outsideFileExists = true;
      try {
        await Deno.stat(outsideFile);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) outsideFileExists = false;
        else throw error;
      }
      assertEquals(outsideFileExists, false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("rejects a symlink escape after an unresolved parent traversal", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsideFile = `${outsideDir}/escaped.txt`;
    try {
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      await assertRejects(
        () => secureFs.writeFile("missing/../link/escaped.txt", "blocked"),
        VeryfrontError,
        "outside base directory",
      );

      let outsideFileExists = true;
      try {
        await Deno.stat(outsideFile);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) outsideFileExists = false;
        else throw error;
      }
      assertEquals(outsideFileExists, false);
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("does not let validation updates replace the configured trust root", async () => {
    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const outsideFile = `${outsideDir}/outside.txt`;
    try {
      await Deno.writeTextFile(outsideFile, "outside");
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      secureFs.updateValidationOptions({
        baseDir: outsideDir,
        adapter: new DenoAdapter(),
      });

      await assertRejects(
        () => secureFs.readFile(outsideFile),
        VeryfrontError,
        "outside base directory",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  describe("getUnsafeAdapter", () => {
    it("throws in production", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        Deno.env.set("NODE_ENV", "production");
        const secureFs = createSecureFs({
          baseDir: "/tmp",
          adapter: createMockAdapter(),
        });

        assertThrows(
          () => secureFs.getUnsafeAdapter(),
          VeryfrontError,
          "not allowed in production",
        );
      } finally {
        if (originalEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });

    it("returns adapter in development", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        Deno.env.set("NODE_ENV", "development");
        const adapter = createMockAdapter();
        const secureFs = createSecureFs({
          baseDir: "/tmp",
          adapter,
        });

        const result = secureFs.getUnsafeAdapter();
        assertEquals(result, adapter);
      } finally {
        if (originalEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });
  });

  it("preserves adapter lifecycle methods with their original receiver", async () => {
    let initialized = false;
    let shutDown = false;
    const adapter = {
      id: "memory",
      name: "lifecycle-test",
      capabilities: {
        typescript: false,
        jsx: false,
        http2: false,
        websocket: false,
        workers: false,
        fileWatching: false,
        shell: false,
        kvStore: false,
        writableFs: false,
      },
      fs: createMockAdapter().fs,
      env: { get: () => undefined, set: () => {}, toObject: () => ({}) },
      server: {},
      serve(
        this: RuntimeAdapter,
        _handler: (request: Request) => Promise<Response> | Response,
        _options: ServeOptions,
      ): Promise<Server> {
        assertStrictEquals(this, adapter);
        return Promise.resolve({
          addr: { hostname: "localhost", port: 0 },
          stop: () => Promise.resolve(),
        });
      },
      initialize(this: RuntimeAdapter): Promise<void> {
        assertStrictEquals(this, adapter);
        initialized = true;
        return Promise.resolve();
      },
      shutdown(this: RuntimeAdapter): Promise<void> {
        assertStrictEquals(this, adapter);
        shutDown = true;
        return Promise.resolve();
      },
    } as unknown as RuntimeAdapter;

    const wrapped = wrapAdapterWithSecurity(adapter, { baseDir: "/tmp" });
    await wrapped.initialize?.();
    await wrapped.serve(() => new Response(), {});
    await wrapped.shutdown?.();

    assertEquals(initialized, true);
    assertEquals(shutDown, true);
    assertStrictEquals(wrapped.env, adapter.env);
    assertStrictEquals(wrapped.server, adapter.server);
  });
});
