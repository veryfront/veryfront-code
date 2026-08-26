import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { findVeryfrontConfigFile, VERYFRONT_CONFIG_FILES } from "./config-files.ts";

describe("config-files", () => {
  it("keeps the recognized config filename list immutable at runtime", () => {
    assertEquals(Object.isFrozen(VERYFRONT_CONFIG_FILES), true);
    assertEquals(VERYFRONT_CONFIG_FILES, [
      "veryfront.config.js",
      "veryfront.config.ts",
      "veryfront.config.mjs",
    ]);
  });

  it("finds an MJS-only config after checking higher-precedence names", async () => {
    const projectDir = "/project";
    const existing = new Set([join(projectDir, "veryfront.config.mjs")]);
    const checked: string[] = [];

    const configFile = await findVeryfrontConfigFile(projectDir, (path) => {
      checked.push(path);
      return existing.has(path);
    });

    assertEquals(configFile, {
      fileName: "veryfront.config.mjs",
      path: join(projectDir, "veryfront.config.mjs"),
    });
    assertEquals(
      checked,
      VERYFRONT_CONFIG_FILES.map((fileName) => join(projectDir, fileName)),
    );
  });

  it("resolves an async existence check before choosing a candidate", async () => {
    const projectDir = "/project";
    const existing = new Set([join(projectDir, "veryfront.config.mjs")]);
    const checked: string[] = [];

    const configFile = await findVeryfrontConfigFile(projectDir, async (path) => {
      checked.push(path);
      return existing.has(path);
    });

    assertEquals(
      configFile,
      {
        fileName: "veryfront.config.mjs",
        path: join(projectDir, "veryfront.config.mjs"),
      },
      "awaits the async existence check instead of treating its promise as truthy",
    );
    assertEquals(
      checked,
      VERYFRONT_CONFIG_FILES.map((fileName) => join(projectDir, fileName)),
      "keeps probing candidates until the async check resolves true",
    );
  });

  it("selects JavaScript before TypeScript and MJS when multiple files exist", async () => {
    const projectDir = "/project";
    const checked: string[] = [];

    const configFile = await findVeryfrontConfigFile(projectDir, (path) => {
      checked.push(path);
      return true;
    });

    assertEquals(configFile, {
      fileName: "veryfront.config.js",
      path: join(projectDir, "veryfront.config.js"),
    });
    assertEquals(checked, [join(projectDir, "veryfront.config.js")]);
  });

  it("preserves UNC project identity in every discovery candidate", async () => {
    for (const projectDir of ["//server/share/project", "\\\\server\\share\\project"]) {
      const checked: string[] = [];

      const configFile = await findVeryfrontConfigFile(projectDir, (path) => {
        checked.push(path);
        return false;
      });

      assertEquals(
        configFile,
        null,
        "reports no config when none of the discovery candidates exist",
      );
      assertEquals(
        checked,
        VERYFRONT_CONFIG_FILES.map(
          (fileName) => `//server/share/project/${fileName}`,
        ),
        "checks every recognized candidate under the preserved UNC namespace",
      );
    }
  });
});
