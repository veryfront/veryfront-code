import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { mkdir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { createSplitterPlugin } from "./esbuild-plugin.ts";
import "../../../transforms/plugins/__tests__/code-parser-setup.ts";
import { MAX_CODE_SPLITTER_MODULE_BYTES } from "./constants.ts";

describe("build/bundler/code-splitter/esbuild-plugin", () => {
  describe("createSplitterPlugin", () => {
    it("should return a plugin with name 'veryfront-splitter'", () => {
      const plugin = createSplitterPlugin("/project");
      assertEquals(plugin.name, "veryfront-splitter");
    });

    it("should have a setup function", () => {
      const plugin = createSplitterPlugin("/project");
      assertEquals(typeof plugin.setup, "function");
    });

    it("should register onResolve and onLoad handlers via setup", () => {
      const plugin = createSplitterPlugin("/project");
      const registered: { type: string; filter: RegExp }[] = [];

      const mockBuild = {
        onResolve(opts: { filter: RegExp }, _cb: unknown) {
          registered.push({ type: "onResolve", filter: opts.filter });
        },
        onLoad(opts: { filter: RegExp; namespace?: string }, _cb: unknown) {
          registered.push({ type: "onLoad", filter: opts.filter });
        },
        onDispose(_cb: unknown) {
          registered.push({ type: "onDispose", filter: /.*/ });
        },
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      const resolveHandlers = registered.filter((r) => r.type === "onResolve");
      const loadHandlers = registered.filter((r) => r.type === "onLoad");
      const disposeHandlers = registered.filter((r) => r.type === "onDispose");

      assertEquals(resolveHandlers.length, 1, "should register one onResolve handler");
      assertEquals(loadHandlers.length, 1, "should register one onLoad handler");
      assertEquals(disposeHandlers.length, 1, "should register 1 onDispose handler");
    });

    it("should handle react resolve by marking as external", () => {
      const plugin = createSplitterPlugin("/project");
      // deno-lint-ignore no-explicit-any
      let reactResolver: (args: any) => any = () => null;

      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("react")) {
            reactResolver = cb;
          }
        },
        onLoad() {},
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      // React should be external
      const result = reactResolver({ path: "react" });
      assertEquals(result?.external, true);
      assertEquals(result?.path, "react");
    });

    it("should return null for unknown react sub-paths not in import map", () => {
      const plugin = createSplitterPlugin("/project");
      // deno-lint-ignore no-explicit-any
      let reactResolver: (args: any) => any = () => null;

      const mockBuild = {
        // deno-lint-ignore no-explicit-any
        onResolve(opts: { filter: RegExp }, cb: (args: any) => any) {
          if (opts.filter.test("react")) {
            reactResolver = cb;
          }
        },
        onLoad() {},
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      // An unknown react path not in the import map should return null
      const result = reactResolver({ path: "react-nonexistent-package" });
      assertEquals(result, null);
    });

    it("strips server-only exports from project JavaScript modules before browser bundling", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-splitter-plugin-project-" });

      try {
        await mkdir(join(projectDir, "app"), { recursive: true });
        const pagePath = join(projectDir, "app/page.tsx");
        await writeTextFile(
          pagePath,
          [
            `import { hashSecret } from "./server-helper.ts";`,
            `export async function getServerData() {`,
            `  return { props: { hashed: hashSecret("server-only") } };`,
            `}`,
            `export default function Page() { return "browser page"; }`,
          ].join("\n"),
        );

        const plugin = createSplitterPlugin(projectDir);
        // deno-lint-ignore no-explicit-any
        let loader: (args: any) => any = () => null;

        const mockBuild = {
          onResolve() {},
          // deno-lint-ignore no-explicit-any
          onLoad(opts: { filter: RegExp; namespace?: string }, cb: (args: any) => any) {
            if (!opts.namespace && opts.filter.test(pagePath)) {
              loader = cb;
            }
          },
          onDispose() {},
        };

        // deno-lint-ignore no-explicit-any
        plugin.setup(mockBuild as any);

        const result = await loader({ path: pagePath });

        assertEquals(result?.loader, "tsx");
        assertEquals(result?.contents.includes("hashSecret"), false);
        assertEquals(result?.contents.includes("./server-helper.ts"), false);
        assertEquals(result?.contents.includes("browser page"), true);
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("leaves node_modules to the package loader and rejects outside-project modules", async () => {
      const rootDir = await Deno.makeTempDir({ prefix: "vf-splitter-boundary-" });
      const projectDir = join(rootDir, "project");
      const outsidePath = join(rootDir, "outside.ts");
      await mkdir(projectDir, { recursive: true });
      await writeTextFile(outsidePath, "export const secret = true;");

      const plugin = createSplitterPlugin(projectDir);
      // deno-lint-ignore no-explicit-any
      let loader: (args: any) => any = () => "missing";

      const mockBuild = {
        onResolve() {},
        // deno-lint-ignore no-explicit-any
        onLoad(opts: { filter: RegExp; namespace?: string }, cb: (args: any) => any) {
          if (!opts.namespace && opts.filter.test("/project/app/page.ts")) {
            loader = cb;
          }
        },
        onDispose() {},
      };

      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      try {
        assertEquals(
          await loader({ path: join(projectDir, "node_modules/pkg/index.ts") }),
          null,
        );
        await assertRejects(
          () => loader({ path: outsidePath }),
          TypeError,
          "outside the project directory",
        );
      } finally {
        await remove(rootDir, { recursive: true });
      }
    });

    it("rejects project modules that are not valid UTF-8", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-splitter-plugin-project-" });
      const modulePath = join(projectDir, "invalid.ts");
      await Deno.writeFile(modulePath, new Uint8Array([0xff]));

      const plugin = createSplitterPlugin(projectDir);
      // deno-lint-ignore no-explicit-any
      let loader: (args: any) => any = () => null;
      const mockBuild = {
        onResolve() {},
        // deno-lint-ignore no-explicit-any
        onLoad(_opts: unknown, cb: (args: any) => any) {
          loader = cb;
        },
        onDispose() {},
      };
      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      try {
        await assertRejects(
          () => loader({ path: modulePath }),
          TypeError,
          "valid UTF-8",
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("rejects oversized project modules before reading them", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-splitter-plugin-project-" });
      const modulePath = join(projectDir, "oversized.ts");
      const file = await Deno.open(modulePath, {
        create: true,
        write: true,
      });
      try {
        await file.truncate(MAX_CODE_SPLITTER_MODULE_BYTES + 1);
      } finally {
        file.close();
      }

      const plugin = createSplitterPlugin(projectDir);
      // deno-lint-ignore no-explicit-any
      let loader: (args: any) => any = () => null;
      const mockBuild = {
        onResolve() {},
        // deno-lint-ignore no-explicit-any
        onLoad(_opts: unknown, cb: (args: any) => any) {
          loader = cb;
        },
        onDispose() {},
      };
      // deno-lint-ignore no-explicit-any
      plugin.setup(mockBuild as any);

      try {
        await assertRejects(
          () => loader({ path: modulePath }),
          TypeError,
          "exceeds",
        );
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });
  });
});
