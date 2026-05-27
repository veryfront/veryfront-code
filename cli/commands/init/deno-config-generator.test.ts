import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";

import { createDenoConfig } from "./deno-config-generator.ts";

describe("deno-config-generator", () => {
  describe("createDenoConfig", () => {
    it("writes deno.json with nodeModulesDir: 'auto'", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createDenoConfig(tmpDir);
        const raw = await Deno.readTextFile(join(tmpDir, "deno.json"));
        const parsed = JSON.parse(raw);
        assertEquals(parsed.nodeModulesDir, "auto");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("writes dev, build, preview tasks invoking npm:veryfront", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createDenoConfig(tmpDir);
        const parsed = JSON.parse(
          await Deno.readTextFile(join(tmpDir, "deno.json")),
        );
        assertEquals(parsed.tasks.dev, "deno run -A npm:veryfront dev");
        assertEquals(parsed.tasks.build, "deno run -A npm:veryfront build");
        assertEquals(
          parsed.tasks.preview,
          "deno run -A npm:veryfront preview",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("writes valid JSON terminated by a newline", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createDenoConfig(tmpDir);
        const raw = await Deno.readTextFile(join(tmpDir, "deno.json"));
        assertEquals(raw.endsWith("\n"), true);
        JSON.parse(raw); // throws if invalid
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("throws if deno.json already exists", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(join(tmpDir, "deno.json"), "{}");
        await assertRejects(
          () => createDenoConfig(tmpDir),
          Error,
          "Refusing to overwrite existing deno.json",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
