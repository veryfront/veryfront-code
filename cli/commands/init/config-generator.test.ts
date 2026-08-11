import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for config-generator
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPackageJson, createTypeScriptConfig } from "./config-generator.ts";
import { join } from "veryfront/platform/path";

describe("config-generator", () => {
  describe("createPackageJson", () => {
    it("is a function", () => {
      assertEquals(typeof createPackageJson, "function");
    });

    it("is an async function", () => {
      assertEquals(createPackageJson.constructor.name, "AsyncFunction");
    });

    it("allows only the transitive esbuild install script under pnpm", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.pnpm?.onlyBuiltDependencies, ["esbuild"]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("includes the standard local developer commands", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.scripts, {
          dev: "veryfront dev",
          build: "veryfront build",
          start: "veryfront serve",
          eval: "veryfront eval",
          deploy: "veryfront deploy",
          typecheck: "tsc --noEmit",
        });
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("installs the TypeScript toolchain the scaffolded tsconfig needs", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));

        // The scaffold ships a tsconfig.json and a `typecheck` script, so the
        // compiler that reads them has to be a declared dependency of the app.
        assertEquals(typeof pkg.devDependencies?.typescript, "string");

        // React types are the part that breaks silently: npm and bun hoist
        // veryfront's transitive @types/react to the project root, pnpm does
        // not, so the identical scaffold typechecks under npm and fails under
        // pnpm with TS7016 on `react/jsx-runtime`. Owning them at the scaffold
        // level makes the three installers agree.
        assertEquals(typeof pkg.devDependencies?.["@types/react"], "string");
        assertEquals(typeof pkg.devDependencies?.["@types/react-dom"], "string");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("pins React types to the React major it installs", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));

        const reactMajor = pkg.dependencies.react.replace(/^\^/, "").split(".")[0];
        for (const types of ["@types/react", "@types/react-dom"]) {
          assertEquals(
            pkg.devDependencies[types].replace(/^\^/, "").split(".")[0],
            reactMajor,
            `${types} must track the React major the scaffold installs`,
          );
        }
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

    it("keeps framework-owned runtime extensions out of the app manifest", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project");
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(pkg.dependencies["@veryfront/ext-bundler-esbuild"], undefined);
        assertEquals(pkg.dependencies["@veryfront/ext-content-mdx"], undefined);
        assertEquals(pkg.dependencies["@veryfront/ext-css-tailwind"], undefined);
        assertEquals(pkg.dependencies["@veryfront/ext-parser-babel"], undefined);
        assertEquals(pkg.dependencies.zod, undefined);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("aligns template-owned first-party extensions to the framework version", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createPackageJson(tmpDir, "test-project", {
          firstPartyExtensions: ["@veryfront/ext-document-kreuzberg"],
        });
        const pkg = JSON.parse(await Deno.readTextFile(join(tmpDir, "package.json")));
        assertEquals(
          pkg.dependencies["@veryfront/ext-document-kreuzberg"],
          pkg.dependencies.veryfront,
        );
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
          "react",
          "react-dom",
          "veryfront",
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

  describe("createTypeScriptConfig", () => {
    it("writes the starter-compatible TypeScript defaults", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createTypeScriptConfig(tmpDir);
        const config = JSON.parse(await Deno.readTextFile(join(tmpDir, "tsconfig.json")));

        assertEquals(config, {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            jsx: "react-jsx",
            skipLibCheck: true,
            esModuleInterop: true,
            paths: { "@/*": ["./*"] },
          },
          include: ["**/*.ts", "**/*.tsx"],
          exclude: ["node_modules"],
        });
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
