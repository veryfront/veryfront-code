import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSecureFs } from "./secure-fs.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";

// Minimal adapter stub — only getUnsafeAdapter() is being tested
function createMockAdapter() {
  return { fs: {} } as any;
}

describe("SecureFs", () => {
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

  it("rejects readDir through a symlink that escapes the base directory", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${outsideDir}/secret.txt`, "outside");
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      await assertRejects(
        async () => {
          for await (const _entry of secureFs.readDir("link")) {
            // Iteration must never expose entries outside the base directory.
          }
        },
        VeryfrontError,
        "outside base directory",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("rejects watch through a symlink that escapes the base directory", async () => {
    if (Deno.build.os === "windows") return;

    const baseDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    try {
      await Deno.symlink(outsideDir, `${baseDir}/link`);
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });
      const watcher = secureFs.watch("link");

      await assertRejects(
        async () => {
          for await (const _event of watcher) {
            // Validation must fail before the platform watcher starts.
          }
        },
        VeryfrontError,
        "outside base directory",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("creates temporary directories inside the configured base", async () => {
    const baseDir = await Deno.makeTempDir();
    try {
      const secureFs = createSecureFs({
        baseDir,
        adapter: new DenoAdapter(),
        context: "internal",
      });

      const tempDir = await secureFs.makeTempDir("work-");
      const canonicalBase = await Deno.realPath(baseDir);
      assertEquals(tempDir.startsWith(`${canonicalBase}/work-`), true);
      assertEquals((await Deno.stat(tempDir)).isDirectory, true);

      await assertRejects(
        () => secureFs.makeTempDir("../escape-"),
        TypeError,
        "prefix",
      );
    } finally {
      await Deno.remove(baseDir, { recursive: true });
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

    it("does not treat ambiguous environment names as development", () => {
      const originalEnv = Deno.env.get("NODE_ENV");
      try {
        for (const value of ["prod", "staging", "Production"]) {
          Deno.env.set("NODE_ENV", value);
          const secureFs = createSecureFs({
            baseDir: "/tmp",
            adapter: createMockAdapter(),
          });
          assertThrows(
            () => secureFs.getUnsafeAdapter(),
            VeryfrontError,
            "not allowed",
          );
        }
      } finally {
        if (originalEnv !== undefined) Deno.env.set("NODE_ENV", originalEnv);
        else Deno.env.delete("NODE_ENV");
      }
    });
  });
});
