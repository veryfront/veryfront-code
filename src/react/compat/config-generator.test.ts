import { describe, it, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import {
  REACT_CONFIGS,
  generateReactVersionConfig,
  generateAllReactConfigs,
  getReactImports,
  detectReactVersionFromConfig,
  createReactVersionSwitcher,
} from "./config-generator.ts";

const TEST_DIR = "/tmp/veryfront-test-config-generator";

describe("config-generator", () => {
  afterEach(async () => {
    try {
      await Deno.remove(TEST_DIR, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("REACT_CONFIGS", () => {
    it("should have configs for all React versions", () => {
      assertEquals(typeof REACT_CONFIGS["17"], "object");
      assertEquals(typeof REACT_CONFIGS["18"], "object");
      assertEquals(typeof REACT_CONFIGS["19"], "object");
    });

    it("should have correct version numbers", () => {
      assertEquals(REACT_CONFIGS["17"].version, "17");
      assertEquals(REACT_CONFIGS["18"].version, "18");
      assertEquals(REACT_CONFIGS["19"].version, "19");
    });

    it("should have exact version strings", () => {
      assertEquals(REACT_CONFIGS["17"].exact, "17.0.2");
      assertEquals(REACT_CONFIGS["18"].exact, "18.2.0");
      assertEquals(REACT_CONFIGS["19"].exact, "19.0.0-rc.0");
    });

    it("should have imports for each version", () => {
      assertExists(REACT_CONFIGS["17"].imports.react);
      assertExists(REACT_CONFIGS["18"].imports.react);
      assertExists(REACT_CONFIGS["19"].imports.react);
    });

    it("should include jsx-runtime imports", () => {
      assertExists(REACT_CONFIGS["17"].imports["react/jsx-runtime"]);
      assertExists(REACT_CONFIGS["18"].imports["react/jsx-runtime"]);
      assertExists(REACT_CONFIGS["19"].imports["react/jsx-runtime"]);
    });

    it("should include react-dom/server imports", () => {
      assertExists(REACT_CONFIGS["17"].imports["react-dom/server"]);
      assertExists(REACT_CONFIGS["18"].imports["react-dom/server"]);
      assertExists(REACT_CONFIGS["19"].imports["react-dom/server"]);
    });

    it("should have client imports for React 18+", () => {
      assertEquals(REACT_CONFIGS["17"].imports["react-dom/client"], undefined);
      assertExists(REACT_CONFIGS["18"].imports["react-dom/client"]);
      assertExists(REACT_CONFIGS["19"].imports["react-dom/client"]);
    });
  });

  describe("getReactImports", () => {
    it("should return imports for React 17", () => {
      const imports = getReactImports("17");
      assertExists(imports);
      assertExists(imports.react);
      assertExists(imports["react-dom"]);
    });

    it("should return imports for React 18", () => {
      const imports = getReactImports("18");
      assertExists(imports);
      assertExists(imports.react);
      assertExists(imports["react-dom/client"]);
    });

    it("should return imports for React 19", () => {
      const imports = getReactImports("19");
      assertExists(imports);
      assertExists(imports.react);
    });

    it("should throw for invalid version", () => {
      try {
        getReactImports("16" as any);
        assertEquals(true, false, "Should have thrown");
      } catch (error) {
        assertExists(error);
      }
    });
  });

  describe("generateReactVersionConfig", () => {
    it("should generate config file for React 18", async () => {
      await ensureDir(TEST_DIR);
      await generateReactVersionConfig(TEST_DIR, "18");

      const configPath = join(TEST_DIR, "deno.react18.json");
      const exists = await Deno.stat(configPath).then(() => true).catch(() => false);
      assertEquals(exists, true);
    });

    it("should include React imports in config", async () => {
      await ensureDir(TEST_DIR);
      await generateReactVersionConfig(TEST_DIR, "18");

      const configPath = join(TEST_DIR, "deno.react18.json");
      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertExists(config.imports);
      assertExists(config.imports.react);
      assertEquals(config.imports.react.includes("18.2.0"), true);
    });

    it("should merge with existing config", async () => {
      await ensureDir(TEST_DIR);
      const baseConfigPath = join(TEST_DIR, "deno.json");
      await Deno.writeTextFile(
        baseConfigPath,
        JSON.stringify({ custom: "value", imports: { other: "import" } }),
      );

      await generateReactVersionConfig(TEST_DIR, "18");

      const configPath = join(TEST_DIR, "deno.react18.json");
      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertEquals(config.custom, "value");
      assertExists(config.imports.other);
      assertExists(config.imports.react);
    });

    it("should throw for invalid version", async () => {
      await ensureDir(TEST_DIR);

      try {
        await generateReactVersionConfig(TEST_DIR, "20" as any);
        assertEquals(true, false, "Should have thrown");
      } catch (error) {
        assertExists(error);
      }
    });
  });

  describe("generateAllReactConfigs", () => {
    it("should generate configs for all versions", async () => {
      await ensureDir(TEST_DIR);
      await generateAllReactConfigs(TEST_DIR);

      const react17Exists = await Deno.stat(join(TEST_DIR, "deno.react17.json"))
        .then(() => true)
        .catch(() => false);
      const react18Exists = await Deno.stat(join(TEST_DIR, "deno.react18.json"))
        .then(() => true)
        .catch(() => false);
      const react19Exists = await Deno.stat(join(TEST_DIR, "deno.react19.json"))
        .then(() => true)
        .catch(() => false);

      assertEquals(react17Exists, true);
      assertEquals(react18Exists, true);
      assertEquals(react19Exists, true);
    });
  });

  describe("detectReactVersionFromConfig", () => {
    it("should detect React 18 from config", async () => {
      await ensureDir(TEST_DIR);
      const configPath = join(TEST_DIR, "deno.json");
      await Deno.writeTextFile(
        configPath,
        JSON.stringify({
          imports: { react: "https://esm.sh/react@18.2.0" },
        }),
      );

      const version = await detectReactVersionFromConfig(TEST_DIR);
      assertEquals(version, "18");
    });

    it("should detect React 17 from config", async () => {
      await ensureDir(TEST_DIR);
      const configPath = join(TEST_DIR, "deno.json");
      await Deno.writeTextFile(
        configPath,
        JSON.stringify({
          imports: { react: "https://esm.sh/react@17.0.2" },
        }),
      );

      const version = await detectReactVersionFromConfig(TEST_DIR);
      assertEquals(version, "17");
    });

    it("should return null if no react import found", async () => {
      await ensureDir(TEST_DIR);
      const configPath = join(TEST_DIR, "deno.json");
      await Deno.writeTextFile(configPath, JSON.stringify({ imports: {} }));

      const version = await detectReactVersionFromConfig(TEST_DIR);
      assertEquals(version, null);
    });

    it("should return null if config file not found", async () => {
      await ensureDir(TEST_DIR);
      const version = await detectReactVersionFromConfig(TEST_DIR);
      assertEquals(version, null);
    });

    it("should detect version from URL pattern", async () => {
      await ensureDir(TEST_DIR);
      const configPath = join(TEST_DIR, "deno.json");
      await Deno.writeTextFile(
        configPath,
        JSON.stringify({
          imports: { react: "npm:react@18" },
        }),
      );

      const version = await detectReactVersionFromConfig(TEST_DIR);
      assertEquals(version, "18");
    });
  });

  describe("createReactVersionSwitcher", () => {
    it("should return a version switcher object", () => {
      const switcher = createReactVersionSwitcher(TEST_DIR);

      assertEquals(typeof switcher.switchTo, "function");
      assertEquals(typeof switcher.getCurrentVersion, "function");
      assertEquals(typeof switcher.getAvailableVersions, "function");
    });

    it("should list available versions", () => {
      const switcher = createReactVersionSwitcher(TEST_DIR);
      const versions = switcher.getAvailableVersions();

      assertEquals(Array.isArray(versions), true);
      assertEquals(versions.includes("17"), true);
      assertEquals(versions.includes("18"), true);
      assertEquals(versions.includes("19"), true);
    });

    it("should switch to a version", async () => {
      await ensureDir(TEST_DIR);
      const switcher = createReactVersionSwitcher(TEST_DIR);

      await switcher.switchTo("18");

      const configExists = await Deno.stat(join(TEST_DIR, "deno.react18.json"))
        .then(() => true)
        .catch(() => false);
      assertEquals(configExists, true);
    });

    it("should detect current version", async () => {
      await ensureDir(TEST_DIR);
      const configPath = join(TEST_DIR, "deno.json");
      await Deno.writeTextFile(
        configPath,
        JSON.stringify({
          imports: { react: "https://esm.sh/react@18.2.0" },
        }),
      );

      const switcher = createReactVersionSwitcher(TEST_DIR);
      const version = await switcher.getCurrentVersion();

      assertEquals(version, "18");
    });
  });
});
