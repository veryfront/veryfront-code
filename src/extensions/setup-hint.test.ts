import { withTempDir } from "#veryfront/testing/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { formatExtensionSetupHint } from "./setup-hint.ts";

describe("extensions/setup-hint", () => {
  it("tells a project with no config file to create one, and what to put in it", async () => {
    // `veryfront init --template minimal` writes package.json, app/, public/,
    // tsconfig.json and no veryfront.config.ts. Verified against published
    // 0.1.1232. Telling that reader to "add it to the extensions in
    // veryfront.config.ts" names a file that does not exist.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"scaffold"}`);

      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      assertEquals(
        hint.includes("create veryfront.config.ts"),
        true,
        `hint must name the file as one to create, got: ${hint}`,
      );
      // The whole file, pasteable as one line. Spelled out rather than derived
      // from the formatter so a formatter that regressed cannot satisfy this
      // by agreeing with itself.
      assertEquals(
        hint.includes(
          `import { defineConfig } from "veryfront"; ` +
            `import extCssLightning from "@veryfront/ext-css-lightning"; ` +
            `export default defineConfig({ extensions: [extCssLightning()] });`,
        ),
        true,
        `hint must carry the complete config file, got: ${hint}`,
      );
      assertEquals(
        hint.includes("npm install @veryfront/ext-css-lightning"),
        true,
        `hint must carry the install command for this project, got: ${hint}`,
      );
    });
  });

  it("says where the composition it recommends stops working", async () => {
    // The recommended config imports the extension, and Veryfront Cloud
    // evaluates a project config as data rather than importing it: the
    // declaration deploys but activates nothing there. A hint that stays
    // silent hands the reader a composition that quietly does less hosted.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"scaffold"}`);

      const created = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });
      await writeTextFile(join(directory, "veryfront.config.ts"), "export default {};\n");
      const existing = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      for (const hint of [created, existing]) {
        assertEquals(
          hint.includes("on Veryfront Cloud the declaration is accepted but ignored"),
          true,
          `hint must say the extension does not run on Veryfront Cloud, got: ${hint}`,
        );
      }
    });
  });

  it("never names `veryfront/config`, which is not an exported subpath", async () => {
    // The obvious guess when the hint stays silent. `veryfront`'s package
    // exports map has no `./config` entry, so Node rejects it with
    // ERR_PACKAGE_PATH_NOT_EXPORTED and the config never loads.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"scaffold"}`);
      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });
      assertEquals(hint.includes(`"veryfront/config"`), false, hint);
    });
  });

  it("edits the config file the project already has, without re-declaring it", async () => {
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"configured"}`);
      await writeTextFile(join(directory, "veryfront.config.ts"), "export default {};\n");

      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      assertEquals(
        hint.includes("create veryfront.config.ts"),
        false,
        `the file exists; the hint must not ask for a second one, got: ${hint}`,
      );
      assertEquals(
        hint.includes(`import extCssLightning from "@veryfront/ext-css-lightning"`),
        true,
        `hint must still show the import line, got: ${hint}`,
      );
      assertEquals(
        hint.includes(`"extensions"`) && hint.includes("extCssLightning()"),
        true,
        `hint must name the array entry to add, got: ${hint}`,
      );
    });
  });

  it("names the config file the project actually keeps", async () => {
    // The loader accepts .js and .mjs too. A hint that hard-codes .ts sends a
    // reader with veryfront.config.js to a second, shadowed file.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"js-config"}`);
      await writeTextFile(join(directory, "veryfront.config.js"), "export default {};\n");

      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      assertEquals(hint.includes("veryfront.config.js"), true, hint);
      assertEquals(hint.includes("veryfront.config.ts"), false, hint);
    });
  });

  it("names a .mjs config file too, which the loader also accepts", async () => {
    // Third and last entry in VERYFRONT_CONFIG_FILES, and the one a lookup
    // that stopped early would drop. Spelled out rather than iterated over the
    // constant: a regression that removed `.mjs` from the loader's list would
    // make an iterating test check one case fewer and still pass.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"mjs-config"}`);
      await writeTextFile(join(directory, "veryfront.config.mjs"), "export default {};\n");

      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      assertEquals(hint.includes("veryfront.config.mjs"), true, hint);
      assertEquals(
        hint.includes("create veryfront.config.ts"),
        false,
        `the project has a config file; the hint must not ask for a second one, got: ${hint}`,
      );
    });
  });

  it("names the higher-precedence config file when a project keeps two", async () => {
    // Precedence is the loader's, not this module's to re-order: a project
    // that keeps two files is told to edit the one findVeryfrontConfigFile
    // actually loads. Spelled out rather than iterated over the constant so a
    // reordered list cannot make the test agree with the regression.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"js-and-ts"}`);
      await writeTextFile(join(directory, "veryfront.config.js"), "export default {};\n");
      await writeTextFile(join(directory, "veryfront.config.ts"), "export default {};\n");

      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      assertEquals(hint.includes("veryfront.config.js"), true, hint);
      assertEquals(
        hint.includes("veryfront.config.ts"),
        false,
        `.ts must not be named while .js shadows it, got: ${hint}`,
      );
    });

    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"ts-and-mjs"}`);
      await writeTextFile(join(directory, "veryfront.config.ts"), "export default {};\n");
      await writeTextFile(join(directory, "veryfront.config.mjs"), "export default {};\n");

      const hint = formatExtensionSetupHint("@veryfront/ext-css-lightning", {
        projectDirectory: directory,
      });

      assertEquals(hint.includes("veryfront.config.ts"), true, hint);
      assertEquals(
        hint.includes("veryfront.config.mjs"),
        false,
        `.mjs must not be named while .ts shadows it, got: ${hint}`,
      );
    });
  });

  it("derives a binding that is a valid identifier for any recommendation", async () => {
    // Every first-party extension exports its factory as the module default,
    // so the local binding is the hint's to choose; it only has to be a legal
    // identifier. `npm:`-prefixed recommendations must not leak the prefix.
    await withTempDir(async (directory) => {
      await writeTextFile(join(directory, "package.json"), `{"name":"identifiers"}`);
      const hint = formatExtensionSetupHint("npm:@veryfront/ext-redis", {
        projectDirectory: directory,
      });
      assertEquals(hint.includes(`import extRedis from "@veryfront/ext-redis"`), true, hint);
      assertEquals(hint.includes("npm:@veryfront/ext-redis"), false, hint);
    });
  });
});
