import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, existsSync, ensureDir, walk } from "./std-fs.ts";

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
  });

  describe("existsSync", () => {
    it("should return true for an existing file", () => {
      assertEquals(existsSync("deno.json"), true);
    });

    it("should return false for a non-existing file", () => {
      assertEquals(existsSync("/nonexistent/path/file.txt"), false);
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
      for await (const entry of walk(tmpDir)) {
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
      for await (const entry of walk(tmpDir, { maxDepth: 0 })) {
        entries.push(entry);
      }

      // maxDepth 0 should only yield entries at root level (sub dir + top.ts)
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
      for await (const entry of walk(tmpDir, { exts: ["ts"] })) {
        entries.push(entry);
      }

      assertEquals(entries.length, 1);
      assertEquals(entries[0].name, "file.ts");
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

    it("should support includeDirs=false", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "vf-walk-" });
      await Deno.mkdir(`${tmpDir}/sub`, { recursive: true });
      await Deno.writeTextFile(`${tmpDir}/sub/file.ts`, "content");

      const entries = [];
      for await (const entry of walk(tmpDir, { includeDirs: false })) {
        entries.push(entry);
      }

      assertEquals(entries.every((e) => e.isFile), true);
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

      assertEquals(entries.every((e) => e.isDirectory), true);
      await Deno.remove(tmpDir, { recursive: true });
    });
  });
});
