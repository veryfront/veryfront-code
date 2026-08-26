import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chmod, mkdir, symlink, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { waitFor, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { toFileUrl } from "#veryfront/compat/path/index.ts";
import { createRequire } from "node:module";
import { MdxContentProcessor } from "@veryfront/ext-content-mdx";
import {
  ensureBuiltinEvalReportExporterRegistry,
  ensureBuiltinLLMProviders,
  ensureBuiltinSchemaValidator,
} from "#veryfront/extensions/builtin-extensions.ts";
import {
  __getBunProjectConfigModuleTrackingCapacityForTests,
  clearConfigCache,
  getConfig,
} from "#veryfront/config/loader.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

describe("Bun workspace resolution", () => {
  it("loads built-in extension modules through workspace package names", () => {
    assertEquals(typeof ensureBuiltinEvalReportExporterRegistry, "function");
    assertEquals(typeof ensureBuiltinLLMProviders, "function");
    assertEquals(typeof ensureBuiltinSchemaValidator, "function");
    assertEquals(typeof MdxContentProcessor, "function");
  });

  it("resolves a dependency installed beneath the project config", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const packageDir = `${projectDir}/node_modules/config-local-dependency`;
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source =
        'import marker from "config-local-dependency";\nconst title: string = marker;\nexport default { title };\n';
      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-local-dependency",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(`${packageDir}/index.js`, 'export default "project-local";\n');
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);
      await chmod(projectDir, 0o555);

      try {
        const config = await getConfig(projectDir, adapter);

        assertEquals(config.title, "project-local");
      } finally {
        await chmod(projectDir, 0o755);
      }
    }, { prefix: "vf-config-local-dependency-" });
  });

  it("reloads a changed project config after cache invalidation", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const writeConfig = async (title: string): Promise<void> => {
        const source = `export default { title: ${JSON.stringify(title)} };\n`;
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
      };

      await writeConfig("before");
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeConfig("after");
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-reload-" });
  });

  it("reloads a changed project config dependency after cache invalidation", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const helperPath = `${projectDir}/config-helper.ts`;
      const source = 'import title from "./config-helper.ts";\nexport default { title };\n';
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      await writeTextFile(helperPath, 'export default "before";\n');
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeTextFile(helperPath, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-dependency-reload-" });
  });

  it("evicts tracked config modules as soon as the config cache is cleared", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const loadMarker = `__vfBunImmediateClear_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const helperPath = `${projectDir}/config-helper.cjs`;
        const source = 'import title from "./config-helper.cjs";\nexport default { title };\n';
        const helperSource = (generation: string): string =>
          `globalThis[${JSON.stringify(loadMarker)}] = ` +
          `(globalThis[${JSON.stringify(loadMarker)}] ?? 0) + 1;\n` +
          `module.exports = ${JSON.stringify(generation)} + "-" + ` +
          `globalThis[${JSON.stringify(loadMarker)}];\n`;
        await writeTextFile(configPath, source);
        await writeTextFile(helperPath, helperSource("before"));
        adapter.fs.files.set(configPath, source);

        assertEquals((await getConfig(projectDir, adapter)).title, "before-1");

        await writeTextFile(helperPath, helperSource("after"));
        clearConfigCache();
        const projectRequire = createRequire(configPath);

        assertEquals(projectRequire(helperPath), "after-2");
        assertEquals((await getConfig(projectDir, adapter)).title, "after-2");
      }, { prefix: "vf-config-bun-immediate-clear-" });
    } finally {
      clearConfigCache();
      delete (globalThis as Record<string, unknown>)[loadMarker];
    }
  });

  it("reloads a changed hoisted workspace dependency after cache invalidation", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (rootDir) => {
      const projectDir = `${rootDir}/apps/site`;
      const packageDir = `${rootDir}/node_modules/config-hoisted-dependency`;
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source = 'import title from "config-hoisted-dependency";\nexport default { title };\n';
      await mkdir(projectDir, { recursive: true });
      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${rootDir}/package.json`,
        JSON.stringify({ name: "workspace-root", workspaces: ["apps/*"] }),
      );
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-hoisted-dependency",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      await writeTextFile(`${packageDir}/index.js`, 'export default "before";\n');
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeTextFile(`${packageDir}/index.js`, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-hoisted-dependency-reload-" });
  });

  it("reloads hoisted dependencies through an out-of-tree workspace symlink", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (rootDir) => {
      const physicalProjectDir = `${rootDir}/apps/site`;
      const linkedProjectDir = `${rootDir}/linked-site`;
      const packageDir = `${rootDir}/node_modules/config-symlinked-hoisted-dependency`;
      const configPath = `${linkedProjectDir}/veryfront.config.ts`;
      const physicalConfigPath = `${physicalProjectDir}/veryfront.config.ts`;
      const source =
        'import title from "config-symlinked-hoisted-dependency";\nexport default { title };\n';
      await mkdir(physicalProjectDir, { recursive: true });
      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${rootDir}/package.json`,
        JSON.stringify({ name: "workspace-root", workspaces: ["apps/*"] }),
      );
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-symlinked-hoisted-dependency",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(physicalConfigPath, source);
      await symlink(physicalProjectDir, linkedProjectDir);
      adapter.fs.files.set(configPath, source);

      await writeTextFile(`${packageDir}/index.js`, 'export default "before";\n');
      assertEquals((await getConfig(linkedProjectDir, adapter)).title, "before");

      await writeTextFile(`${packageDir}/index.js`, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(linkedProjectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-symlinked-hoisted-dependency-" });
  });

  it("transfers a shared CommonJS helper between tracked workspace configs", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (rootDir) => {
      const firstProjectDir = `${rootDir}/apps/first`;
      const secondProjectDir = `${rootDir}/apps/second`;
      const firstConfigPath = `${firstProjectDir}/veryfront.config.ts`;
      const secondConfigPath = `${secondProjectDir}/veryfront.config.ts`;
      const helperPath = `${rootDir}/shared-helper.cjs`;
      const source = 'import title from "../../shared-helper.cjs";\nexport default { title };\n';
      await mkdir(firstProjectDir, { recursive: true });
      await mkdir(secondProjectDir, { recursive: true });
      await writeTextFile(
        `${rootDir}/package.json`,
        JSON.stringify({ name: "workspace-root", workspaces: ["apps/*"] }),
      );
      await writeTextFile(firstConfigPath, source);
      await writeTextFile(secondConfigPath, source);
      adapter.fs.files.set(firstConfigPath, source);
      adapter.fs.files.set(secondConfigPath, source);

      await writeTextFile(helperPath, 'module.exports = "before";\n');
      assertEquals((await getConfig(firstProjectDir, adapter)).title, "before");
      assertEquals((await getConfig(secondProjectDir, adapter)).title, "before");

      const trackingCapacity = __getBunProjectConfigModuleTrackingCapacityForTests();
      for (let index = 0; index < trackingCapacity - 1; index++) {
        const fillerDir = `${rootDir}/filler-${index}`;
        const fillerConfigPath = `${fillerDir}/veryfront.config.ts`;
        const fillerSource = `export default { title: "filler-${index}" };\n`;
        await mkdir(fillerDir, { recursive: true });
        await writeTextFile(fillerConfigPath, fillerSource);
        adapter.fs.files.set(fillerConfigPath, fillerSource);
        await getConfig(fillerDir, adapter);
      }

      assertEquals((await getConfig(secondProjectDir, adapter)).title, "before");
      await writeTextFile(helperPath, 'module.exports = "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(firstProjectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-shared-config-helper-" });
  });

  it("recovers after a missing project dependency is installed", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const packageDir = `${projectDir}/node_modules/config-late-dependency`;
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source =
        'import marker from "config-late-dependency";\nexport default { title: marker };\n';
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      await assertRejects(() => getConfig(projectDir, adapter), Error);

      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-late-dependency",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(`${packageDir}/index.js`, 'export default "installed";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "installed");
    }, { prefix: "vf-config-bun-recovery-" });
  });

  it("reloads dependencies retained by a failed config evaluation", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const helperPath = `${projectDir}/config-helper.ts`;
      const source = 'import title from "./config-helper.ts";\n' +
        'if (title === "before") throw new Error("stale helper");\n' +
        "export default { title };\n";
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      await writeTextFile(helperPath, 'export default "before";\n');
      await assertRejects(() => getConfig(projectDir, adapter), Error);

      await writeTextFile(helperPath, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-failed-dependency-reload-" });
  });

  it("reloads a changed project config that uses top-level await", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const writeConfig = async (title: string): Promise<void> => {
        const source = `const title = await Promise.resolve(${JSON.stringify(title)});\n` +
          "export default { title };\n";
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
      };

      await writeConfig("before");
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeConfig("after");
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-top-level-await-" });
  });

  it("evaluates the synchronous prefix of a top-level-await config once", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const executionMarker = `__vfBunTlaExecution_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const source = `globalThis[${JSON.stringify(executionMarker)}] = ` +
          `(globalThis[${JSON.stringify(executionMarker)}] ?? 0) + 1;\n` +
          "await Promise.resolve();\n" +
          `export default { title: String(globalThis[${JSON.stringify(executionMarker)}]) };\n`;
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        assertEquals((await getConfig(projectDir, adapter)).title, "1");
        assertEquals((globalThis as Record<string, unknown>)[executionMarker], 1);
      }, { prefix: "vf-config-bun-tla-single-execution-" });
    } finally {
      clearConfigCache();
      delete (globalThis as Record<string, unknown>)[executionMarker];
    }
  });

  it("reloads a changed transitive dynamic dependency of a top-level-await config", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const entryPath = `${projectDir}/config-entry.ts`;
      const helperPath = `${projectDir}/config-helper.ts`;
      const source = "await Promise.resolve();\n" +
        'const { default: title } = await import("./config-entry.ts");\n' +
        "export default { title };\n";
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);
      await writeTextFile(
        entryPath,
        'import title from "./config-helper.ts";\nexport default title;\n',
      );

      await writeTextFile(helperPath, 'export default "before";\n');
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeTextFile(helperPath, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-tla-dependency-reload-" });
  });

  it("reloads a computed dynamic dependency of a top-level-await config", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const helperPath = `${projectDir}/config-helper.ts`;
      const source = 'const dependency = "./config-helper.ts";\n' +
        "const { default: title } = await import(dependency);\n" +
        "export default { title };\n";
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      await writeTextFile(helperPath, 'export default "before";\n');
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeTextFile(helperPath, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-computed-dependency-reload-" });
  });

  it("observes computed imports when the config shadows globalThis", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const source = "const globalThis = {};\n" +
        'const dependency = "data:text/javascript,export default %27shadow-safe%27";\n' +
        "const { default: title } = await import(dependency);\n" +
        "export default { title };\n";
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      assertEquals((await getConfig(projectDir, adapter)).title, "shadow-safe");
    }, { prefix: "vf-config-bun-shadowed-global-observer-" });
  });

  it("rewrites overlapping nested computed-import ranges", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const finalModule = "data:text/javascript,export default 'nested-import'";
      const innerModule = "data:text/javascript," +
        encodeURIComponent(`export default ${JSON.stringify(finalModule)};`);
      const source = `const dependency = ${JSON.stringify(innerModule)};\n` +
        "const { default: title } = " +
        "await import((await import(dependency)).default);\n" +
        "export default { title };\n";
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      assertEquals((await getConfig(projectDir, adapter)).title, "nested-import");
    }, { prefix: "vf-config-bun-nested-computed-import-" });
  });

  it("resolves computed bare imports from the original project", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const packageDir = `${projectDir}/node_modules/config-computed-package`;
      const source = 'const dependency = "config-computed-package";\n' +
        "const { default: title } = await import(dependency);\n" +
        "export default { title };\n";
      await mkdir(packageDir, { recursive: true });
      await writeTextFile(
        `${packageDir}/package.json`,
        JSON.stringify({
          name: "config-computed-package",
          type: "module",
          exports: "./index.js",
        }),
      );
      await writeTextFile(`${packageDir}/index.js`, 'export default "project-package";\n');
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);

      assertEquals((await getConfig(projectDir, adapter)).title, "project-package");
    }, { prefix: "vf-config-bun-computed-package-" });
  });

  it("keeps computed dynamic imports usable in deferred config functions", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const resultMarker = `__vfBunDeferredConfigImport_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const helperPath = `${projectDir}/deferred-helper.ts`;
        const source = `const dependency = "./deferred-helper.ts";\n` +
          "await Promise.resolve();\n" +
          "export default { extensions: [{\n" +
          '  name: "deferred-import", version: "1", capabilities: [],\n' +
          "  async setup() {\n" +
          "    const { default: value } = await import(dependency);\n" +
          `    globalThis[${JSON.stringify(resultMarker)}] = value;\n` +
          "  },\n" +
          "}] };\n";
        await writeTextFile(configPath, source);
        await writeTextFile(helperPath, 'export default "before";\n');
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        const extension = config.extensions?.[0] as { setup?: () => Promise<void> };
        await extension.setup?.();

        assertEquals((globalThis as Record<string, unknown>)[resultMarker], "before");

        await writeTextFile(helperPath, 'export default "after";\n');
        clearConfigCache();
        const reloaded = await getConfig(projectDir, adapter);
        const reloadedExtension = reloaded.extensions?.[0] as {
          setup?: () => Promise<void>;
        };
        await reloadedExtension.setup?.();

        assertEquals((globalThis as Record<string, unknown>)[resultMarker], "after");
      }, { prefix: "vf-config-bun-deferred-computed-import-" });
    } finally {
      delete (globalThis as Record<string, unknown>)[resultMarker];
    }
  });

  it("evicts transitive deferred imports discovered after cache clearing", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const clearMarker = `__vfBunDeferredClear_${crypto.randomUUID().replaceAll("-", "_")}`;
    const resultMarker = `__vfBunDeferredTransitive_${crypto.randomUUID().replaceAll("-", "_")}`;
    let clearOnce = true;
    const globals = globalThis as Record<string, unknown>;
    globals[clearMarker] = () => {
      if (!clearOnce) return;
      clearOnce = false;
      clearConfigCache();
    };
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const entryPath = `${projectDir}/deferred-entry.ts`;
        const helperPath = `${projectDir}/deferred-helper.ts`;
        const source = `const dependency = "./deferred-entry.ts";\n` +
          "await Promise.resolve();\n" +
          "export default { extensions: [{\n" +
          '  name: "deferred-transitive", version: "1", capabilities: [],\n' +
          "  async setup() {\n" +
          "    const { default: value } = await import(dependency);\n" +
          `    globalThis[${JSON.stringify(resultMarker)}] = value;\n` +
          "  },\n" +
          "}] };\n";
        await writeTextFile(configPath, source);
        await writeTextFile(
          entryPath,
          'import value from "./deferred-helper.ts";\nexport default value;\n',
        );
        await writeTextFile(
          helperPath,
          `globalThis[${JSON.stringify(clearMarker)}]();\nexport default "before";\n`,
        );
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        const extension = config.extensions?.[0] as { setup?: () => Promise<void> };
        await extension.setup?.();
        assertEquals(globals[resultMarker], "before");

        await writeTextFile(helperPath, 'export default "after";\n');
        const reloaded = await getConfig(projectDir, adapter);
        const reloadedExtension = reloaded.extensions?.[0] as {
          setup?: () => Promise<void>;
        };
        await reloadedExtension.setup?.();
        assertEquals(globals[resultMarker], "after");
      }, { prefix: "vf-config-bun-deferred-transitive-clear-" });
    } finally {
      clearConfigCache();
      delete globals[clearMarker];
      delete globals[resultMarker];
    }
  });

  it("resolves deferred computed bare imports from the original project", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const resultMarker = `__vfBunDeferredBareImport_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const packageDir = `${projectDir}/node_modules/config-deferred-package`;
        const source = 'const dependency = "config-deferred-package";\n' +
          "await Promise.resolve();\n" +
          "export default { extensions: [{\n" +
          '  name: "deferred-bare-import", version: "1", capabilities: [],\n' +
          "  async setup() {\n" +
          "    const { default: value } = await import(dependency);\n" +
          `    globalThis[${JSON.stringify(resultMarker)}] = value;\n` +
          "  },\n" +
          "}] };\n";
        await mkdir(packageDir, { recursive: true });
        await writeTextFile(
          `${packageDir}/package.json`,
          JSON.stringify({
            name: "config-deferred-package",
            type: "module",
            exports: "./index.js",
          }),
        );
        await writeTextFile(`${packageDir}/index.js`, 'export default "deferred-package";\n');
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);

        const config = await getConfig(projectDir, adapter);
        const extension = config.extensions?.[0] as { setup?: () => Promise<void> };
        await extension.setup?.();

        assertEquals((globalThis as Record<string, unknown>)[resultMarker], "deferred-package");
      }, { prefix: "vf-config-bun-deferred-bare-import-" });
    } finally {
      clearConfigCache();
      delete (globalThis as Record<string, unknown>)[resultMarker];
    }
  });

  it("reloads config dependencies through a symlinked project directory", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (rootDir) => {
      const physicalProjectDir = `${rootDir}/physical-project`;
      const linkedProjectDir = `${rootDir}/linked-project`;
      const configPath = `${linkedProjectDir}/veryfront.config.ts`;
      const physicalConfigPath = `${physicalProjectDir}/veryfront.config.ts`;
      const helperPath = `${physicalProjectDir}/config-helper.ts`;
      const source = 'import title from "./config-helper.ts";\nexport default { title };\n';
      await mkdir(physicalProjectDir, { recursive: true });
      await writeTextFile(physicalConfigPath, source);
      await writeTextFile(helperPath, 'export default "before";\n');
      await symlink(physicalProjectDir, linkedProjectDir);
      adapter.fs.files.set(configPath, source);

      assertEquals((await getConfig(linkedProjectDir, adapter)).title, "before");

      await writeTextFile(helperPath, 'export default "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(linkedProjectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-symlinked-project-reload-" });
  });

  it("touches symlinked config-file tracking by its canonical path", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const loadMarker = `__vfBunSymlinkTracking_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (rootDir) => {
        const physicalProjectDir = `${rootDir}/physical-project`;
        const linkedProjectDir = `${rootDir}/linked-project`;
        const physicalConfigPath = `${physicalProjectDir}/veryfront.config.ts`;
        const linkedConfigPath = `${linkedProjectDir}/veryfront.config.ts`;
        const helperPath = `${physicalProjectDir}/config-helper.cjs`;
        const linkedHelperPath = `${linkedProjectDir}/config-helper.cjs`;
        const source = 'import title from "./config-helper.cjs";\nexport default { title };\n';
        await mkdir(physicalProjectDir, { recursive: true });
        await mkdir(linkedProjectDir, { recursive: true });
        await writeTextFile(physicalConfigPath, source);
        await writeTextFile(
          helperPath,
          `globalThis[${JSON.stringify(loadMarker)}] = ` +
            `(globalThis[${JSON.stringify(loadMarker)}] ?? 0) + 1;\n` +
            `module.exports = "generation-" + globalThis[${JSON.stringify(loadMarker)}];\n`,
        );
        await symlink(physicalConfigPath, linkedConfigPath);
        await symlink(helperPath, linkedHelperPath);
        adapter.fs.files.set(linkedConfigPath, source);

        assertEquals((await getConfig(linkedProjectDir, adapter)).title, "generation-1");

        const trackingCapacity = __getBunProjectConfigModuleTrackingCapacityForTests();
        for (let index = 0; index < trackingCapacity - 1; index++) {
          const fillerDir = `${rootDir}/filler-${index}`;
          const fillerConfigPath = `${fillerDir}/veryfront.config.ts`;
          const fillerSource = `export default { title: "filler-${index}" };\n`;
          await mkdir(fillerDir, { recursive: true });
          await writeTextFile(fillerConfigPath, fillerSource);
          adapter.fs.files.set(fillerConfigPath, fillerSource);
          await getConfig(fillerDir, adapter);
        }

        // A cache hit must refresh the canonical tracking entry, not the
        // lexical symlink path that never became an LRU key.
        assertEquals((await getConfig(linkedProjectDir, adapter)).title, "generation-1");
        const finalDir = `${rootDir}/filler-final`;
        const finalConfigPath = `${finalDir}/veryfront.config.ts`;
        const finalSource = 'export default { title: "filler-final" };\n';
        await mkdir(finalDir, { recursive: true });
        await writeTextFile(finalConfigPath, finalSource);
        adapter.fs.files.set(finalConfigPath, finalSource);
        await getConfig(finalDir, adapter);

        const projectRequire = createRequire(linkedConfigPath);
        assertEquals(projectRequire(linkedHelperPath), "generation-1");
        assertEquals((globalThis as Record<string, unknown>)[loadMarker], 1);
      }, { prefix: "vf-config-bun-symlink-tracking-touch-" });
    } finally {
      clearConfigCache();
      delete (globalThis as Record<string, unknown>)[loadMarker];
    }
  });

  it("reloads a CommonJS helper required by a top-level-await config dependency", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const entryPath = `${projectDir}/config-entry.cjs`;
      const helperPath = `${projectDir}/config-helper.cjs`;
      // The module lexer cannot see the entry's require() edge, so the helper
      // must be claimed through Bun's runtime CommonJS child tracking.
      const source = "await Promise.resolve();\n" +
        'const { default: title } = await import("./config-entry.cjs");\n' +
        "export default { title };\n";
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);
      await writeTextFile(
        entryPath,
        'module.exports = require("./config-helper.cjs");\n',
      );

      await writeTextFile(helperPath, 'module.exports = "before";\n');
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeTextFile(helperPath, 'module.exports = "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-tla-cjs-descendant-reload-" });
  });

  it("reloads a computed import inside a top-level-await config dependency", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      const entryPath = `${projectDir}/config-entry.ts`;
      const helperPath = `${projectDir}/config-helper.cjs`;
      const source = 'import title from "./config-entry.ts";\n' +
        "await Promise.resolve();\nexport default { title };\n";
      const entrySource = 'const helper = "./config-helper.cjs";\n' +
        "const imported = await import(helper);\nexport default imported.default;\n";
      await writeTextFile(configPath, source);
      await writeTextFile(entryPath, entrySource);
      adapter.fs.files.set(configPath, source);

      await writeTextFile(helperPath, 'module.exports = "before";\n');
      assertEquals((await getConfig(projectDir, adapter)).title, "before");

      await writeTextFile(helperPath, 'module.exports = "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-transitive-computed-import-" });
  });

  it("evicts tracked config modules when their tracking entry reaches capacity", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (rootDir) => {
      const firstProjectDir = `${rootDir}/first`;
      const firstConfigPath = `${firstProjectDir}/veryfront.config.ts`;
      const helperPath = `${firstProjectDir}/config-helper.ts`;
      const firstSource = 'import title from "./config-helper.ts";\nexport default { title };\n';
      await mkdir(firstProjectDir, { recursive: true });
      await writeTextFile(firstConfigPath, firstSource);
      await writeTextFile(helperPath, 'export default "before";\n');
      adapter.fs.files.set(firstConfigPath, firstSource);

      assertEquals((await getConfig(firstProjectDir, adapter)).title, "before");
      await writeTextFile(helperPath, 'export default "after";\n');

      const trackingCapacity = __getBunProjectConfigModuleTrackingCapacityForTests();
      for (let index = 0; index < trackingCapacity; index++) {
        const fillerDir = `${rootDir}/filler-${index}`;
        const fillerConfigPath = `${fillerDir}/veryfront.config.ts`;
        const fillerSource = `export default { title: "filler-${index}" };\n`;
        await mkdir(fillerDir, { recursive: true });
        await writeTextFile(fillerConfigPath, fillerSource);
        adapter.fs.files.set(fillerConfigPath, fillerSource);
        assertEquals((await getConfig(fillerDir, adapter)).title, `filler-${index}`);
      }

      clearConfigCache();
      assertEquals((await getConfig(firstProjectDir, adapter)).title, "after");
    }, { prefix: "vf-config-bun-tracking-capacity-" });
  });

  it("evicts Bun tracking when default config entries evict its config cache entry", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const loadMarker = `__vfBunConfigCacheEviction_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (rootDir) => {
        const projectDir = `${rootDir}/configured`;
        const configPath = `${projectDir}/veryfront.config.ts`;
        const helperPath = `${projectDir}/config-helper.cjs`;
        const source = 'import title from "./config-helper.cjs";\nexport default { title };\n';
        const helperSource = (generation: string): string =>
          `globalThis[${JSON.stringify(loadMarker)}] = ` +
          `(globalThis[${JSON.stringify(loadMarker)}] ?? 0) + 1;\n` +
          `module.exports = ${JSON.stringify(generation)} + "-" + ` +
          `globalThis[${JSON.stringify(loadMarker)}];\n`;
        await mkdir(projectDir, { recursive: true });
        await writeTextFile(configPath, source);
        await writeTextFile(helperPath, helperSource("before"));
        adapter.fs.files.set(configPath, source);

        assertEquals((await getConfig(projectDir, adapter)).title, "before-1");
        await writeTextFile(helperPath, helperSource("after"));

        const cacheCapacity = __getBunProjectConfigModuleTrackingCapacityForTests();
        for (let index = 0; index < cacheCapacity; index++) {
          await getConfig(`${rootDir}/defaults-${index}`, adapter);
        }

        const projectRequire = createRequire(configPath);
        assertEquals(projectRequire(helperPath), "after-2");
        assertEquals((await getConfig(projectDir, adapter)).title, "after-2");
      }, { prefix: "vf-config-bun-config-capacity-" });
    } finally {
      clearConfigCache();
      delete (globalThis as Record<string, unknown>)[loadMarker];
    }
  });

  it("does not let failed loads evict a live config tracking entry", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const loadMarker = `__vfBunLiveTracking_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      await withTempDir(async (rootDir) => {
        const liveProjectDir = `${rootDir}/live`;
        const liveConfigPath = `${liveProjectDir}/veryfront.config.ts`;
        const helperPath = `${liveProjectDir}/config-helper.cjs`;
        const liveSource = 'import title from "./config-helper.cjs";\nexport default { title };\n';
        await mkdir(liveProjectDir, { recursive: true });
        await writeTextFile(liveConfigPath, liveSource);
        await writeTextFile(
          helperPath,
          `globalThis[${JSON.stringify(loadMarker)}] = ` +
            `(globalThis[${JSON.stringify(loadMarker)}] ?? 0) + 1;\n` +
            `module.exports = "generation-" + globalThis[${JSON.stringify(loadMarker)}];\n`,
        );
        adapter.fs.files.set(liveConfigPath, liveSource);

        assertEquals((await getConfig(liveProjectDir, adapter)).title, "generation-1");

        const trackingCapacity = __getBunProjectConfigModuleTrackingCapacityForTests();
        for (let index = 0; index < trackingCapacity; index++) {
          const failedDir = `${rootDir}/failed-${index}`;
          const failedConfigPath = `${failedDir}/veryfront.config.js`;
          const failedSource = `throw new Error("failed-${index}");\n`;
          await mkdir(failedDir, { recursive: true });
          await writeTextFile(failedConfigPath, failedSource);
          adapter.fs.files.set(failedConfigPath, failedSource);
          await assertRejects(() => getConfig(failedDir, adapter), Error);
        }

        const projectRequire = createRequire(liveConfigPath);
        assertEquals(projectRequire(helperPath), "generation-1");
        assertEquals((globalThis as Record<string, unknown>)[loadMarker], 1);
      }, { prefix: "vf-config-bun-failed-tracking-capacity-" });
    } finally {
      delete (globalThis as Record<string, unknown>)[loadMarker];
    }
  });

  it("does not evict an unrelated module loaded while an async config is evaluating", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const activeMarker = "__vfBunAsyncConfigActive";
    const loadCountMarker = "__vfBunUnrelatedModuleLoads";
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const unrelatedPath = `${projectDir}/unrelated.cjs`;
        const source = `globalThis.${activeMarker} = true;\n` +
          "await new Promise((resolve) => setTimeout(resolve, 100));\n" +
          'export default { title: "ready" };\n';
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
        await writeTextFile(
          unrelatedPath,
          `globalThis.${loadCountMarker} = (globalThis.${loadCountMarker} ?? 0) + 1;\n` +
            `module.exports = globalThis.${loadCountMarker};\n`,
        );
        const projectRequire = createRequire(toFileUrl(configPath));

        const firstConfig = getConfig(projectDir, adapter);
        await waitFor(
          () => (globalThis as Record<string, unknown>)[activeMarker] === true,
        );
        assertEquals(projectRequire(unrelatedPath), 1);
        assertEquals((await firstConfig).title, "ready");

        clearConfigCache();
        assertEquals((await getConfig(projectDir, adapter)).title, "ready");
        assertEquals(projectRequire(unrelatedPath), 1);
      }, { prefix: "vf-config-bun-unrelated-cache-" });
    } finally {
      delete (globalThis as Record<string, unknown>)[activeMarker];
      delete (globalThis as Record<string, unknown>)[loadCountMarker];
    }
  });

  it("does not duplicate a config dependency later shared by application code", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    await withTempDir(async (projectDir) => {
      const configPath = `${projectDir}/veryfront.config.ts`;
      // The shared dependency is CommonJS: Bun records `Module.children` edges
      // only between CommonJS modules, so a CommonJS consumer of an ES-module
      // helper leaves no observable reference for eviction to retain.
      const helperPath = `${projectDir}/config-helper.cjs`;
      const consumerPath = `${projectDir}/application-consumer.cjs`;
      const source = 'import title from "./config-helper.cjs";\nexport default { title };\n';
      await writeTextFile(configPath, source);
      adapter.fs.files.set(configPath, source);
      await writeTextFile(helperPath, 'module.exports = "before";\n');
      await writeTextFile(
        consumerPath,
        'module.exports = require("./config-helper.cjs");\n',
      );

      assertEquals((await getConfig(projectDir, adapter)).title, "before");
      const projectRequire = createRequire(toFileUrl(configPath));
      const applicationValue = projectRequire(consumerPath);
      const sharedValue = projectRequire(helperPath);
      assertEquals(applicationValue, sharedValue);

      await writeTextFile(helperPath, 'module.exports = "after";\n');
      clearConfigCache();

      assertEquals((await getConfig(projectDir, adapter)).title, "before");
      assertEquals(projectRequire(helperPath), sharedValue);
      assertEquals(projectRequire(consumerPath), applicationValue);
    }, { prefix: "vf-config-bun-shared-dependency-" });
  });

  it("serializes overlapping config revisions before evicting their dependencies", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const activeMarker = "__vfBunOverlappingConfigActive";
    const gateMarker = "__vfBunOverlappingConfigGate";
    const gate = Promise.withResolvers<void>();
    const globals = globalThis as Record<string, unknown>;
    globals[gateMarker] = gate.promise;
    try {
      await withTempDir(async (projectDir) => {
        const configPath = `${projectDir}/veryfront.config.ts`;
        const helperPath = `${projectDir}/config-helper.ts`;
        const source = 'import title from "./config-helper.ts";\n' +
          `globalThis.${activeMarker} = true;\n` +
          `await globalThis.${gateMarker};\n` +
          "export default { title };\n";
        await writeTextFile(configPath, source);
        adapter.fs.files.set(configPath, source);
        await writeTextFile(helperPath, 'export default "before";\n');

        const firstConfig = getConfig(projectDir, adapter);
        await waitFor(() => globals[activeMarker] === true);
        await writeTextFile(helperPath, 'export default "after";\n');
        clearConfigCache();
        const secondConfig = getConfig(projectDir, adapter);
        let secondSettled = false;
        void secondConfig.then(() => {
          secondSettled = true;
        }, () => {
          secondSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        assertEquals(secondSettled, false);

        gate.resolve();

        assertEquals((await firstConfig).title, "before");
        assertEquals((await secondConfig).title, "after");
      }, { prefix: "vf-config-bun-overlapping-revisions-" });
    } finally {
      gate.resolve();
      delete globals[activeMarker];
      delete globals[gateMarker];
    }
  });

  it("serializes real and symlinked loads of the same config path", async () => {
    clearConfigCache();
    ensureBuiltinSchemaValidator();
    const adapter = createMockAdapter();
    const activeMarker = `__vfBunCanonicalConfigActive_${crypto.randomUUID().replaceAll("-", "_")}`;
    const gateMarker = `__vfBunCanonicalConfigGate_${crypto.randomUUID().replaceAll("-", "_")}`;
    const gate = Promise.withResolvers<void>();
    const globals = globalThis as Record<string, unknown>;
    globals[gateMarker] = gate.promise;
    try {
      await withTempDir(async (rootDir) => {
        const physicalProjectDir = `${rootDir}/physical-project`;
        const linkedProjectDir = `${rootDir}/linked-project`;
        const physicalConfigPath = `${physicalProjectDir}/veryfront.config.ts`;
        const linkedConfigPath = `${linkedProjectDir}/veryfront.config.ts`;
        const helperPath = `${physicalProjectDir}/config-helper.ts`;
        const source = 'import title from "./config-helper.ts";\n' +
          `globalThis[${JSON.stringify(activeMarker)}] = true;\n` +
          `await globalThis[${JSON.stringify(gateMarker)}];\n` +
          "export default { title };\n";
        await mkdir(physicalProjectDir, { recursive: true });
        await writeTextFile(physicalConfigPath, source);
        await writeTextFile(helperPath, 'export default "before";\n');
        await symlink(physicalProjectDir, linkedProjectDir);
        adapter.fs.files.set(physicalConfigPath, source);
        adapter.fs.files.set(linkedConfigPath, source);

        const physicalLoad = getConfig(physicalProjectDir, adapter);
        await waitFor(() => globals[activeMarker] === true);
        await writeTextFile(helperPath, 'export default "after";\n');
        const linkedLoad = getConfig(linkedProjectDir, adapter);
        let linkedSettled = false;
        void linkedLoad.then(() => {
          linkedSettled = true;
        }, () => {
          linkedSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        assertEquals(linkedSettled, false);

        gate.resolve();

        assertEquals((await physicalLoad).title, "before");
        assertEquals((await linkedLoad).title, "after");
      }, { prefix: "vf-config-bun-canonical-load-lock-" });
    } finally {
      gate.resolve();
      delete globals[activeMarker];
      delete globals[gateMarker];
    }
  });
});
