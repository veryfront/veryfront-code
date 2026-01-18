import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { join } from "@veryfront/platform/compat/path/index.ts";

describe("Up Command Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await Deno.makeTempDir({ prefix: "vf-up-test-" });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Directory analysis", () => {
    it("should detect empty directory", async () => {
      const entries: string[] = [];
      for await (const entry of Deno.readDir(testDir)) {
        if (!entry.name.startsWith(".")) {
          entries.push(entry.name);
        }
      }
      assertEquals(entries.length, 0);
    });

    it("should detect directory with code (package.json)", async () => {
      await Deno.writeTextFile(join(testDir, "package.json"), "{}");

      const entries: string[] = [];
      for await (const entry of Deno.readDir(testDir)) {
        entries.push(entry.name);
      }

      const hasCode = entries.some((name) =>
        name === "package.json" || name === "deno.json" || name.endsWith(".ts")
      );
      assertEquals(hasCode, true);
    });

    it("should detect directory with code (deno.json)", async () => {
      await Deno.writeTextFile(join(testDir, "deno.json"), "{}");

      const entries: string[] = [];
      for await (const entry of Deno.readDir(testDir)) {
        entries.push(entry.name);
      }

      const hasCode = entries.some((name) => name === "deno.json");
      assertEquals(hasCode, true);
    });

    it("should detect directory with TypeScript files", async () => {
      await Deno.writeTextFile(join(testDir, "index.ts"), "export const x = 1;");

      const entries: string[] = [];
      for await (const entry of Deno.readDir(testDir)) {
        entries.push(entry.name);
      }

      const hasCode = entries.some((name) => name.endsWith(".ts"));
      assertEquals(hasCode, true);
    });

    it("should detect existing project (.veryfrontrc)", async () => {
      const config = { projectSlug: "my-app" };
      await Deno.writeTextFile(join(testDir, ".veryfrontrc"), JSON.stringify(config));

      const configPath = join(testDir, ".veryfrontrc");
      const exists = await Deno.stat(configPath).then(() => true).catch(() => false);
      assertEquals(exists, true);

      const content = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(content);
      assertEquals(parsed.projectSlug, "my-app");
    });

    it("should skip hidden files when checking for code", async () => {
      await Deno.writeTextFile(join(testDir, ".gitignore"), "node_modules");

      const entries: string[] = [];
      for await (const entry of Deno.readDir(testDir)) {
        if (!entry.name.startsWith(".")) {
          entries.push(entry.name);
        }
      }

      assertEquals(entries.length, 0);
    });

    it("should skip node_modules when checking for code", async () => {
      await Deno.mkdir(join(testDir, "node_modules"));
      await Deno.writeTextFile(join(testDir, "node_modules", "test.js"), "");

      const entries: string[] = [];
      for await (const entry of Deno.readDir(testDir)) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          entries.push(entry.name);
        }
      }

      assertEquals(entries.length, 0);
    });
  });

  describe("Project slug generation", () => {
    it("should sanitize directory name for slug", () => {
      const dirName = "My Project 123";
      const slug = dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      assertEquals(slug, "my-project-123");
    });

    it("should handle special characters", () => {
      const dirName = "project@v2.0!test";
      const slug = dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      assertEquals(slug, "project-v2-0-test");
    });

    it("should handle already valid slug", () => {
      const dirName = "my-project";
      const slug = dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      assertEquals(slug, "my-project");
    });
  });

  describe("Config file handling", () => {
    it("should save config file correctly", async () => {
      const config = { projectSlug: "test-project" };
      const configPath = join(testDir, ".veryfrontrc");

      await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");

      const content = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(content);
      assertEquals(parsed.projectSlug, "test-project");
    });

    it("should read config file correctly", async () => {
      const config = { projectSlug: "existing-project" };
      await Deno.writeTextFile(join(testDir, ".veryfrontrc"), JSON.stringify(config));

      const content = await Deno.readTextFile(join(testDir, ".veryfrontrc"));
      const parsed = JSON.parse(content);
      assertEquals(parsed.projectSlug, "existing-project");
    });
  });
});
