import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for config-generator
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPackageJson } from "./config-generator.ts";
import { join } from "veryfront/platform/path";

describe("config-generator", () => {
  describe("createPackageJson", () => {
    it("is a function", () => {
      assertEquals(typeof createPackageJson, "function");
    });

    it("is an async function", () => {
      assertEquals(createPackageJson.constructor.name, "AsyncFunction");
    });

    it("includes pnpm.onlyBuiltDependencies for esbuild and veryfront", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.pnpm?.onlyBuiltDependencies, ["esbuild", "veryfront"]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("pins React defaults to the framework npm shim version", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.dependencies.react, "^19.2.4");
        assertEquals(pkg.dependencies["react-dom"], "^19.2.4");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("includes first-party extension packages required by npm CLI dev and build", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(
          pkg.dependencies["@veryfront/ext-bundler-esbuild"],
          pkg.dependencies.veryfront,
        );
        assertEquals(pkg.dependencies["@veryfront/ext-content-mdx"], pkg.dependencies.veryfront);
        assertEquals(pkg.dependencies["@veryfront/ext-css-tailwind"], pkg.dependencies.veryfront);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("merges npmDependencies from selected integrations", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "demo", {
          integrations: [
            {
              name: "neon",
              npmDependencies: { pg: "^8.13.1" },
            },
            {
              name: "stripe",
              npmDependencies: { stripe: "^17.0.0" },
            },
          ],
        });

        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.dependencies.pg, "^8.13.1");
        assertEquals(pkg.dependencies.stripe, "^17.0.0");
        // existing defaults still present
        assertEquals(pkg.dependencies.veryfront !== undefined, true);
        assertEquals(pkg.dependencies.react !== undefined, true);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("is a no-op for integrations without npmDependencies", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "demo", {
          integrations: [{ name: "slack" }], // no npmDependencies
        });
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(Object.keys(pkg.dependencies).sort(), [
          "@veryfront/ext-bundler-esbuild",
          "@veryfront/ext-content-mdx",
          "@veryfront/ext-css-tailwind",
          "react",
          "react-dom",
          "veryfront",
          "zod",
        ]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("later integrations do not clobber earlier ones on version collision", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "demo", {
          integrations: [
            { name: "a", npmDependencies: { shared: "^1.0.0" } },
            { name: "b", npmDependencies: { shared: "^2.0.0" } },
          ],
        });
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        // First declaration wins; second is skipped with a warning logged by the impl.
        assertEquals(pkg.dependencies.shared, "^1.0.0");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
