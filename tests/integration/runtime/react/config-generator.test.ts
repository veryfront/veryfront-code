import { assert, assertEquals, assertThrows } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import {
  createReactVersionSwitcher,
  detectReactVersionFromConfig,
  generateAllReactConfigs,
  generateReactVersionConfig,
  getReactImports,
  REACT_CONFIGS,
  type ReactVersion,
} from "@veryfront/react/compat/config-generator.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import type { TestContext } from "../../../_helpers/context.ts";

describe(
  "React Config Generator",
  
  () => {
    describe("Config Generation", () => {
      it("generates valid React 17 config", async () => {
        await withTestContext("config-gen-17", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateReactVersionConfig(context.projectDir, "17");
          const path = `${context.projectDir}/deno.react17.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(typeof config.imports.react, "string");
          assertEquals(config.imports.react.includes("17.0.2"), true);
          assertEquals(typeof config.imports["react-dom"], "string");
        });
      });

      it("generates valid React 18 config", async () => {
        await withTestContext("config-gen-18", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateReactVersionConfig(context.projectDir, "18");
          const path = `${context.projectDir}/deno.react18.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(typeof config.imports.react, "string");
          assertEquals(config.imports.react.includes("18.2.0"), true);
          assertEquals(typeof config.imports["react-dom/client"], "string");
        });
      });

      it("generates valid React 19 config", async () => {
        await withTestContext("config-gen-19", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateReactVersionConfig(context.projectDir, "19");
          const path = `${context.projectDir}/deno.react19.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(typeof config.imports.react, "string");
          assertEquals(config.imports.react.includes("19.0.0"), true);
        });
      });

      it("includes all required React imports", async () => {
        await withTestContext("config-gen-imports", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateReactVersionConfig(context.projectDir, "18");
          const path = `${context.projectDir}/deno.react18.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(typeof config.imports.react, "string");
          assertEquals(typeof config.imports["react-dom"], "string");
          assertEquals(typeof config.imports["react-dom/server"], "string");
          assertEquals(typeof config.imports["react/jsx-runtime"], "string");
          assertEquals(typeof config.imports["react/jsx-dev-runtime"], "string");
        });
      });

      it("merges with existing deno.json config", async () => {
        await withTestContext("config-gen-merge", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify(
              {
                imports: { "my-lib": "https://example.com/lib.ts" },
                tasks: { dev: "deno run -A main.ts" },
              },
              null,
              2,
            ),
          );

          await generateReactVersionConfig(context.projectDir, "18");
          const path = `${context.projectDir}/deno.react18.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(config.imports["my-lib"], "https://example.com/lib.ts");
          assertEquals(config.tasks.dev, "deno run -A main.ts");
          assertEquals(typeof config.imports.react, "string");
        });
      });

      it("generates all version configs", async () => {
        await withTestContext("config-gen-all", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateAllReactConfigs(context.projectDir);

          for (const version of ["17", "18", "19"]) {
            const path = `${context.projectDir}/deno.react${version}.json`;
            const text = await Deno.readTextFile(path);
            const config = JSON.parse(text);
            assertEquals(typeof config.imports.react, "string");
          }
        });
      });
    });

    describe("Import Map Retrieval", () => {
      it("returns React 17 imports", () => {
        const imports = getReactImports("17");
        assertEquals(typeof imports.react, "string");
        assert(imports.react?.includes("17.0.2"));
        assertEquals(typeof imports["react-dom/server"], "string");
      });

      it("returns React 18 imports with client", () => {
        const imports = getReactImports("18");
        assertEquals(typeof imports.react, "string");
        assertEquals(typeof imports["react-dom/client"], "string");
      });

      it("returns React 19 imports", () => {
        const imports = getReactImports("19");
        assertEquals(typeof imports.react, "string");
        assert(imports.react?.includes("19.0.0"));
      });

      it("throws on invalid version", () => {
        assertThrows(() => getReactImports("20" as ReactVersion));
        assertThrows(() => getReactImports("16" as ReactVersion));
      });

      it("all versions have jsx-runtime", () => {
        for (const version of ["17", "18", "19"] as ReactVersion[]) {
          const imports = getReactImports(version);
          assertEquals(typeof imports["react/jsx-runtime"], "string");
          assertEquals(typeof imports["react/jsx-dev-runtime"], "string");
        }
      });
    });

    describe("Version Detection from Config", () => {
      it("detects React 17 from exact version", async () => {
        await withTestContext("detect-17-exact", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: { react: REACT_CONFIGS["17"].imports.react } }, null, 2),
          );

          const detected = await detectReactVersionFromConfig(context.projectDir);
          assertEquals(detected, "17");
        });
      });

      it("detects React 18 from exact version", async () => {
        await withTestContext("detect-18-exact", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: { react: REACT_CONFIGS["18"].imports.react } }, null, 2),
          );

          const detected = await detectReactVersionFromConfig(context.projectDir);
          assertEquals(detected, "18");
        });
      });

      it("detects version from major version only", async () => {
        await withTestContext("detect-major", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: { react: "https://esm.sh/react@18" } }, null, 2),
          );

          const detected = await detectReactVersionFromConfig(context.projectDir);
          assertEquals(detected, "18");
        });
      });

      it("returns null when no React import", async () => {
        await withTestContext("detect-none", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: { other: "https://example.com" } }, null, 2),
          );

          const detected = await detectReactVersionFromConfig(context.projectDir);
          assertEquals(detected, null);
        });
      });

      it("returns null when deno.json missing", async () => {
        await withTestContext("detect-missing", async (context: TestContext) => {
          const detected = await detectReactVersionFromConfig(context.projectDir);
          assertEquals(detected, null);
        });
      });

      it("handles malformed deno.json", async () => {
        await withTestContext("detect-malformed", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            "invalid json {",
          );

          const detected = await detectReactVersionFromConfig(context.projectDir);
          assertEquals(detected, null);
        });
      });
    });

    describe("Version Switcher", () => {
      it("creates switcher with available versions", async () => {
        await withTestContext("switcher-create", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          const switcher = createReactVersionSwitcher(context.projectDir);
          const versions = switcher.getAvailableVersions();

          assertEquals(Array.isArray(versions), true);
          assertEquals(versions.length, 3);
          assertEquals(versions.includes("17"), true);
          assertEquals(versions.includes("18"), true);
          assertEquals(versions.includes("19"), true);
        });
      });

      it("switches to React version", async () => {
        await withTestContext("switcher-switch", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          const switcher = createReactVersionSwitcher(context.projectDir);
          await switcher.switchTo("18");

          const configPath = `${context.projectDir}/deno.react18.json`;
          const exists = await Deno.stat(configPath);
          assertEquals(exists.isFile, true);
        });
      });

      it("gets current version from config", async () => {
        await withTestContext("switcher-current", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: { react: REACT_CONFIGS["18"].imports.react } }, null, 2),
          );

          const switcher = createReactVersionSwitcher(context.projectDir);
          const current = await switcher.getCurrentVersion();
          assertEquals(current, "18");
        });
      });

      it("reuses existing config when switching", async () => {
        await withTestContext("switcher-reuse", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateReactVersionConfig(context.projectDir, "17");

          const switcher = createReactVersionSwitcher(context.projectDir);
          await switcher.switchTo("17");

          const configPath = `${context.projectDir}/deno.react17.json`;
          const exists = await Deno.stat(configPath);
          assertEquals(exists.isFile, true);
        });
      });
    });

    describe("Extended Configuration Options", () => {
      it("extends from custom base config", async () => {
        await withTestContext("config-extends", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/base.json`,
            JSON.stringify(
              {
                compilerOptions: { jsx: "react-jsx", strict: true },
              },
              null,
              2,
            ),
          );

          await generateReactVersionConfig(context.projectDir, "18", {
            extends: "base.json",
          });

          const path = `${context.projectDir}/deno.react18.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(config.compilerOptions.jsx, "react-jsx");
          assertEquals(config.compilerOptions.strict, true);
        });
      });

      it("merges additional imports", async () => {
        await withTestContext("config-additional", async (context: TestContext) => {
          await Deno.writeTextFile(
            `${context.projectDir}/deno.json`,
            JSON.stringify({ imports: {} }, null, 2),
          );

          await generateReactVersionConfig(context.projectDir, "18", {
            additional: {
              imports: {
                "custom-lib": "https://example.com/lib.ts",
              },
            },
          });

          const path = `${context.projectDir}/deno.react18.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(config.imports["custom-lib"], "https://example.com/lib.ts");
          assertEquals(typeof config.imports.react, "string");
        });
      });

      it("handles missing base config gracefully", async () => {
        await withTestContext("config-missing-base", async (context: TestContext) => {
          await generateReactVersionConfig(context.projectDir, "18", {
            extends: "nonexistent.json",
          });

          const path = `${context.projectDir}/deno.react18.json`;
          const text = await Deno.readTextFile(path);
          const config = JSON.parse(text);

          assertEquals(typeof config.imports.react, "string");
        });
      });
    });

    describe("Error Handling", () => {
      it("throws on unsupported version in generate", async () => {
        await withTestContext("error-unsupported", async (context: TestContext) => {
          let threw = false;
          try {
            await generateReactVersionConfig(context.projectDir, "20" as ReactVersion);
          } catch (e) {
            threw = true;
            assert(e instanceof Error);
            assert(e.message.includes("Unsupported"));
          }
          assertEquals(threw, true);
        });
      });

      it("validates REACT_CONFIGS structure", () => {
        assertEquals(typeof REACT_CONFIGS["17"], "object");
        assertEquals(typeof REACT_CONFIGS["18"], "object");
        assertEquals(typeof REACT_CONFIGS["19"], "object");

        for (const version of ["17", "18", "19"] as ReactVersion[]) {
          assertEquals(REACT_CONFIGS[version].version, version);
          assertEquals(typeof REACT_CONFIGS[version].exact, "string");
          assertEquals(typeof REACT_CONFIGS[version].imports, "object");
        }
      });
    });
  },
);
