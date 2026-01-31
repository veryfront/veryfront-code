import { assertEquals } from "@veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/platform/compat/path/index.ts";
import {
  exists,
  makeTempDir,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@veryfront/compat/fs.ts";

function getSlug(dirName: string): string {
  return dirName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

async function listDirNames(
  dir: string,
  options: { skipHidden?: boolean; skipNodeModules?: boolean } = {},
): Promise<string[]> {
  const { skipHidden = false, skipNodeModules = false } = options;
  const entries: string[] = [];

  for await (const entry of readDir(dir)) {
    if (skipHidden && entry.name.startsWith(".")) continue;
    if (skipNodeModules && entry.name === "node_modules") continue;
    entries.push(entry.name);
  }

  return entries;
}

describe("Up Command Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await makeTempDir({ prefix: "vf-up-test-" });
  });

  afterEach(async () => {
    try {
      await remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Directory analysis", () => {
    it("should detect empty directory", async () => {
      const entries = await listDirNames(testDir, { skipHidden: true });
      assertEquals(entries.length, 0);
    });

    it("should detect directory with code (package.json)", async () => {
      await writeTextFile(join(testDir, "package.json"), "{}");

      const entries = await listDirNames(testDir);
      const hasCode = entries.some((name) =>
        name === "package.json" || name === "deno.json" || name.endsWith(".ts")
      );

      assertEquals(hasCode, true);
    });

    it("should detect directory with code (deno.json)", async () => {
      await writeTextFile(join(testDir, "deno.json"), "{}");

      const entries = await listDirNames(testDir);
      const hasCode = entries.includes("deno.json");

      assertEquals(hasCode, true);
    });

    it("should detect directory with TypeScript files", async () => {
      await writeTextFile(join(testDir, "index.ts"), "export const x = 1;");

      const entries = await listDirNames(testDir);
      const hasCode = entries.some((name) => name.endsWith(".ts"));

      assertEquals(hasCode, true);
    });

    it("should detect existing project (.veryfrontrc)", async () => {
      const config = { projectSlug: "my-app" };
      const configPath = join(testDir, ".veryfrontrc");

      await writeTextFile(configPath, JSON.stringify(config));

      assertEquals(await exists(configPath), true);

      const content = await readTextFile(configPath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.projectSlug, "my-app");
    });

    it("should skip hidden files when checking for code", async () => {
      await writeTextFile(join(testDir, ".gitignore"), "node_modules");

      const entries = await listDirNames(testDir, { skipHidden: true });
      assertEquals(entries.length, 0);
    });

    it("should skip node_modules when checking for code", async () => {
      await mkdir(join(testDir, "node_modules"));
      await writeTextFile(join(testDir, "node_modules", "test.js"), "");

      const entries = await listDirNames(testDir, { skipHidden: true, skipNodeModules: true });
      assertEquals(entries.length, 0);
    });
  });

  describe("Project slug generation", () => {
    it("should sanitize directory name for slug", () => {
      assertEquals(getSlug("My Project 123"), "my-project-123");
    });

    it("should handle special characters", () => {
      assertEquals(getSlug("project@v2.0!test"), "project-v2-0-test");
    });

    it("should handle already valid slug", () => {
      assertEquals(getSlug("my-project"), "my-project");
    });
  });

  describe("Config file handling", () => {
    it("should save config file correctly", async () => {
      const config = { projectSlug: "test-project" };
      const configPath = join(testDir, ".veryfrontrc");

      await writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");

      const content = await readTextFile(configPath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.projectSlug, "test-project");
    });

    it("should read config file correctly", async () => {
      const config = { projectSlug: "existing-project" };
      const configPath = join(testDir, ".veryfrontrc");

      await writeTextFile(configPath, JSON.stringify(config));

      const content = await readTextFile(configPath);
      const parsed = JSON.parse(content);

      assertEquals(parsed.projectSlug, "existing-project");
    });
  });
});
