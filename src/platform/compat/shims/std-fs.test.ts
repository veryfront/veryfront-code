import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ensureDir, exists, existsSync, walk } from "./std-fs.ts";

describe("platform/compat/shims/std-fs", () => {
  describe("exists", () => {
    it("should return true for an existing file", async () => {
      // deno.json should exist at the project root
      assertEquals(await exists("deno.json"), true);
    });

    it("should return false for a non-existing file", async () => {
      assertEquals(await exists("/nonexistent/path/file.txt"), false);
    });

    it("should return true for an existing directory", async () => {
      assertEquals(await exists("src"), true);
    });

    it("propagates failures that do not mean the path is missing", async () => {
      await assertRejects(() => exists("\0"), TypeError);
    });
  });

  describe("existsSync", () => {
    it("should return true for an existing file", () => {
      assertEquals(existsSync("deno.json"), true);
    });

    it("should return false for a non-existing file", () => {
      assertEquals(existsSync("/nonexistent/path/file.txt"), false);
    });

    it("propagates synchronous failures that are not missing paths", () => {
      assertThrows(() => existsSync("\0"), TypeError);
    });
  });

  describe("ensureDir", () => {
    it("should create a directory recursively", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-test-" });
      const nested = `${tmpDir}/a/b/c`;
      await ensureDir(nested);
      assertEquals(await exists(nested), true);
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("should be idempotent on existing directory", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-test-" });
      await ensureDir(tmpDir);
      assertEquals(await exists(tmpDir), true);
      await Deno.remove(tmpDir, { recursive: true });
    });
  });

  describe("walk", () => {
    it("should yield files in a directory", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.writeTextFile(`${tmpDir}/a.ts`, "content");
      await Deno.writeTextFile(`${tmpDir}/b.ts`, "content");

      const entries = [];
      for await (const entry of walk(tmpDir, { includeDirs: false })) {
        entries.push(entry);
      }

      assertEquals(entries.length, 2);
      assertEquals(entries.every((e) => e.isFile), true);
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("should respect maxDepth option", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.mkdir(`${tmpDir}/sub`, { recursive: true });
      await Deno.writeTextFile(`${tmpDir}/top.ts`, "content");
      await Deno.writeTextFile(`${tmpDir}/sub/deep.ts`, "content");

      const entries = [];
      for await (const entry of walk(tmpDir, { maxDepth: 1 })) {
        entries.push(entry);
      }

      // maxDepth 1 yields the root and its immediate children.
      const fileNames = entries.filter((e) => e.isFile).map((e) => e.name);
      assertEquals(fileNames.includes("top.ts"), true);
      assertEquals(fileNames.includes("deep.ts"), false);
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("should filter by extension", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.writeTextFile(`${tmpDir}/file.ts`, "ts");
      await Deno.writeTextFile(`${tmpDir}/file.js`, "js");
      await Deno.writeTextFile(`${tmpDir}/file.txt`, "txt");

      const entries = [];
      for await (const entry of walk(tmpDir, { exts: ["ts"], includeDirs: false })) {
        entries.push(entry);
      }

      assertEquals(entries.length, 1);
      assertEquals(entries[0]!.name, "file.ts");
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("accepts extensions with or without a leading dot", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.writeTextFile(`${tmpDir}/file.ts`, "ts");

      const entries = [];
      for await (const entry of walk(tmpDir, { exts: [".ts"], includeDirs: false })) {
        entries.push(entry);
      }

      assertEquals(entries.map((entry) => entry.name), ["file.ts"]);
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("should skip paths matching skip patterns", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.mkdir(`${tmpDir}/node_modules`, { recursive: true });
      await Deno.writeTextFile(`${tmpDir}/node_modules/pkg.js`, "pkg");
      await Deno.writeTextFile(`${tmpDir}/app.ts`, "app");

      const entries = [];
      for await (const entry of walk(tmpDir, { skip: [/node_modules/] })) {
        entries.push(entry);
      }

      assertEquals(entries.every((e) => !e.path.includes("node_modules")), true);
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("handles global skip expressions deterministically", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.writeTextFile(`${tmpDir}/skip-a.ts`, "a");
      await Deno.writeTextFile(`${tmpDir}/skip-b.ts`, "b");
      await Deno.writeTextFile(`${tmpDir}/visible.ts`, "visible");

      const names = [];
      for await (const entry of walk(tmpDir, { includeDirs: false, skip: [/skip-/g] })) {
        names.push(entry.name);
      }

      assertEquals(names, ["visible.ts"]);
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("should support includeDirs=false", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.mkdir(`${tmpDir}/sub`, { recursive: true });
      await Deno.writeTextFile(`${tmpDir}/sub/file.ts`, "content");

      const entries = [];
      for await (const entry of walk(tmpDir, { includeDirs: false })) {
        entries.push(entry);
      }

      assertEquals(
        entries.every((e) => e.isFile),
        true,
        "includeDirs=false must not yield directories",
      );
      assertEquals(
        entries.some((e) => e.name === "file.ts"),
        true,
        "includeDirs=false must still yield nested files",
      );
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("should support includeFiles=false", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.mkdir(`${tmpDir}/sub`, { recursive: true });
      await Deno.writeTextFile(`${tmpDir}/file.ts`, "content");

      const entries = [];
      for await (const entry of walk(tmpDir, { includeFiles: false })) {
        entries.push(entry);
      }

      assertEquals(
        entries.every((e) => e.isDirectory),
        true,
        "includeFiles=false must not yield files",
      );
      assertEquals(
        entries.some((e) => e.name === "sub"),
        true,
        "includeFiles=false must still yield nested directories",
      );
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("rejects invalid maxDepth values", async () => {
      await assertRejects(
        async () => {
          for await (const _entry of walk(".", { maxDepth: Number.NaN })) {
            // The iterator rejects before walking.
          }
        },
        RangeError,
        "maxDepth",
      );
    });
  });
});
