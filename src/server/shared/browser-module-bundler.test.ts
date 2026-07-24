import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  bundleBrowserModule,
  bundleBrowserModuleWithMetadata,
  getSafeBrowserModuleIdentity,
  validateBrowserModuleBundle,
} from "./browser-module-bundler.ts";

describe(
  "server/shared/browser-module-bundler",
  () => {
    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    });

    it("does not expose the project path through dependency module identities", async () => {
      const tenantMarker = "PRIVATE_TENANT_PATH_MARKER";
      const projectDir = `/private/tenants/${tenantMarker}/project`;
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import { marker } from "./shared.ts";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
      );
      adapter.fs.files.set(
        dependencyPath,
        'export const marker = "SHARED_BROWSER_DEPENDENCY";',
      );

      const output = await bundleBrowserModule(entryPath, { adapter, projectDir });

      assertStringIncludes(output, "SHARED_BROWSER_DEPENDENCY");
      assertEquals(output.includes(projectDir), false);
      assertEquals(output.includes(tenantMarker), false);
    });

    it("rejects a browser entry reached through a symbolic link", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Leak.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        'export const marker = "SYMLINKED_ENTRY_MARKER";',
      );
      const readDir = adapter.fs.readDir;
      adapter.fs.readDir = (path: string) =>
        path === `${projectDir}/app`
          ? (async function* () {
            yield {
              name: "Leak.ts",
              isFile: false,
              isDirectory: false,
              isSymlink: true,
            };
          })()
          : readDir(path);

      await assertRejects(
        () => bundleBrowserModule(entryPath, { adapter, projectDir }),
        Error,
      );
    });

    it("rejects entries outside the project before reading them", async () => {
      const projectDir = "/project";
      const entryPath = "/outside/Leak.ts";
      const adapter = createMockAdapter();
      let wasRead = false;
      adapter.fs.readFile = () => {
        wasRead = true;
        return Promise.resolve('export const marker = "OUTSIDE_ENTRY_MARKER";');
      };

      await assertRejects(
        () => bundleBrowserModule(entryPath, { adapter, projectDir }),
        Error,
      );
      assertEquals(wasRead, false);
    });

    it("fails closed when the bundler produces no output", async () => {
      const projectDir = "/private/tenants/PRIVATE_NO_OUTPUT_MARKER/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, '"use client"; export default null;');
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });

      try {
        const error = await assertRejects(
          () => bundleBrowserModule(entryPath, { adapter, projectDir }),
          Error,
          "Browser module bundler produced no output",
        );
        assertEquals(String(error).includes(entryPath), false);
        assertEquals(String(error).includes("PRIVATE_NO_OUTPUT_MARKER"), false);
      } finally {
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("rejects a browser entry containing a function-local server action", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const marker = "ENTRY_FUNCTION_LOCAL_SERVER_SECRET_MARKER";
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          "export async function save() {",
          '  "use server";',
          `  return "${marker}";`,
          "}",
          "export default function Counter() { return null; }",
        ].join("\n"),
      );

      let error: unknown;
      try {
        await bundleBrowserModule(entryPath, { adapter, projectDir });
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof Error, true);
      assertEquals(String(error).includes(marker), false);
    });

    it("invalidates bundle metadata when entry or dependency content changes", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import { marker } from "./shared.ts";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
      );
      adapter.fs.files.set(dependencyPath, 'export const marker = "FIRST";');

      const first = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
      });
      assertEquals(await validateBrowserModuleBundle(first, { adapter, projectDir }), true);

      adapter.fs.files.set(dependencyPath, 'export const marker = "SECOND";');
      assertEquals(await validateBrowserModuleBundle(first, { adapter, projectDir }), false);

      const second = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
      });
      adapter.fs.files.set(
        entryPath,
        adapter.fs.files.get(entryPath)!.replace("return marker", "return marker + marker"),
      );
      assertEquals(await validateBrowserModuleBundle(second, { adapter, projectDir }), false);
    });

    it("invalidates when a new higher-priority import resolution candidate appears", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import { marker } from "./shared";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
      );
      adapter.fs.files.set(dependencyPath, 'export const marker = "TYPESCRIPT";');

      const bundle = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
      });
      adapter.fs.files.set(
        `${projectDir}/app/shared.tsx`,
        'export const marker = "NEW_HIGHER_PRIORITY_TSX";',
      );

      assertEquals(await validateBrowserModuleBundle(bundle, { adapter, projectDir }), false);
    });

    it("uses the supplied effective import map for the bundle", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import marker from "custom-package";',
          "export default marker;",
        ].join("\n"),
      );

      const ownedImportMapJson = JSON.stringify({
        imports: { "custom-package": "https://cdn.example/custom-package.js" },
      });
      const unownedImportMapJson = JSON.stringify({ imports: {} });
      const owned = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
        importMapJson: ownedImportMapJson,
      });
      const unowned = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
        importMapJson: unownedImportMapJson,
      });

      assertStringIncludes(owned.source, 'from "custom-package"');
      assertStringIncludes(unowned.source, 'from "https://esm.sh/custom-package"');
      assertEquals(owned.importMapHash, await computeHash(ownedImportMapJson));
      assertEquals(unowned.importMapHash, await computeHash(unownedImportMapJson));
      assertEquals(owned.importMapHash === unowned.importMapHash, false);
    });

    it("accepts top-level await in browser modules", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'const marker = await Promise.resolve("BROWSER_TLA_MARKER");',
          "export default marker;",
        ].join("\n"),
      );

      const output = await bundleBrowserModule(entryPath, { adapter, projectDir });

      assertStringIncludes(output, 'await Promise.resolve("BROWSER_TLA_MARKER")');
    });

    it("uses only project-relative identities for source files and spans", () => {
      assertEquals(
        getSafeBrowserModuleIdentity(
          "/private/tenant/project/app/Counter.tsx",
          "/private/tenant/project",
        ),
        "/app/Counter.tsx",
      );
      assertEquals(
        getSafeBrowserModuleIdentity("/private/tenant/secret.ts", "/project"),
        "/secret.ts",
      );
    });
  },
);
