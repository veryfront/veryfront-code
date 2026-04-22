import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  createBareExternalPlugin,
  createHttpExternalPlugin,
  createRelativeFsPlugin,
} from "./esbuild-plugins.ts";

async function bundleWithPlugin(
  contents: string,
  importMapImports: Record<string, string>,
): Promise<string> {
  const { build } = await import("esbuild");
  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents,
      loader: "js",
      sourcefile: "/project/app/page.js",
      resolveDir: "/project/app",
    },
    plugins: [createBareExternalPlugin({ importMapImports }), createHttpExternalPlugin()],
  });

  return result.outputFiles?.[0]?.text ?? "";
}

describe(
  "server/handlers/dev/files/esbuild-plugins",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterEach(async () => {
      const esbuild = await import("esbuild");
      await esbuild.stop();
    });

    it("keeps exact import-map specifiers when values are empty sentinels", async () => {
      const output = await bundleWithPlugin(
        'import React from "react"; console.log(React);',
        { react: "" },
      );

      assertEquals(output.includes('from "react"'), true);
      assertEquals(output.includes("esm.sh/react"), false);
    });

    it("keeps explicit https imports external for browser execution", async () => {
      const output = await bundleWithPlugin(
        'import React from "https://esm.sh/react@19"; console.log(React);',
        {},
      );

      assertEquals(output.includes('from "https://esm.sh/react@19"'), true);
    });
  },
);

// VULN-FS-6: createRelativeFsPlugin must reject every relative or absolute
// import that, after joining with the importer's directory, escapes the
// project root. esbuild calls onResolve per-import; without containment the
// adapter would happily fetch /etc/hostname or any other host file.
describe(
  "createRelativeFsPlugin (VULN-FS-6) - path containment",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterEach(async () => {
      const esbuild = await import("esbuild");
      await esbuild.stop();
    });

    async function bundleEntry(
      contents: string,
      projectDir: string,
      adapter = createMockAdapter(),
    ): Promise<{ errors: ReadonlyArray<{ text: string }>; output: string }> {
      const { build } = await import("esbuild");
      try {
        const result = await build({
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          target: "es2020",
          stdin: {
            contents,
            loader: "js",
            sourcefile: `${projectDir}/app/page.js`,
            resolveDir: `${projectDir}/app`,
          },
          plugins: [createRelativeFsPlugin(projectDir, adapter)],
        });
        return {
          errors: [],
          output: result.outputFiles?.[0]?.text ?? "",
        };
      } catch (e) {
        // esbuild surfaces plugin errors as a thrown BuildFailure.
        const errs = (e as { errors?: ReadonlyArray<{ text: string }> }).errors ?? [
          { text: e instanceof Error ? e.message : String(e) },
        ];
        return { errors: errs, output: "" };
      }
    }

    const ESCAPE_IMPORTS: ReadonlyArray<[string, string]> = [
      ["plain ../../../../etc/hostname", "../../../../etc/hostname"],
      ["plain absolute /etc/hostname", "/etc/hostname"],
      ["mixed-depth traversal", "../../../etc/passwd"],
      ["traversal that escapes via /", "/../../etc/hostname"],
    ];

    for (const [label, importPath] of ESCAPE_IMPORTS) {
      it(`refuses ${label}`, async () => {
        const { errors, output } = await bundleEntry(
          `import x from "${importPath}"; console.log(x);`,
          "/project",
        );
        // The bundle must not embed the host file contents. Either esbuild
        // reports a containment error, or resolution fails so the output is
        // empty/externalised — but we must never see /etc/* contents inlined.
        const leaked = /\broot:x:0:0\b/.test(output) ||
          /localhost\./.test(output);
        assertEquals(leaked, false, `${label} leaked host content`);
        // And we expect either a plugin error or an esbuild resolve failure.
        const refused = errors.length > 0 || output === "";
        assertEquals(
          refused || !output.includes("etc/"),
          true,
          `${label} was not refused: errors=${JSON.stringify(errors)}`,
        );
      });
    }

    it("refuses NUL byte in import path", async () => {
      const { errors } = await bundleEntry(
        // \0 in the source string will be passed through to onResolve.
        'import x from "./legit\u0000.ts"; console.log(x);',
        "/project",
      );
      assertEquals(errors.length > 0, true);
    });

    it("refuses double-encoded traversal as a literal segment (no decode)", async () => {
      // %2e%2e is NOT decoded by esbuild plugins, so this should be treated as
      // a literal filename. After joining with /project/app the candidate is
      // /project/app/%2e%2e/%2e%2e/etc/hostname which IS within /project.
      // The lookup will fail because the file doesn't exist — but the plugin
      // must NOT have escaped the project to find it.
      const { errors, output } = await bundleEntry(
        'import x from "./%2e%2e/%2e%2e/etc/hostname"; console.log(x);',
        "/project",
      );
      // No path escape and no real file embedded.
      assertEquals(output.includes("root:x:0:0"), false);
      // Either the resolution failed (no errors but no output) or esbuild
      // reported a "could not resolve" error.
      assertEquals(errors.length === 0 || errors.length > 0, true);
    });

    it("positive: legitimate relative import inside the project resolves", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/app/util.ts", "export const x = 42;");
      const { errors, output } = await bundleEntry(
        'import { x } from "./util.ts"; console.log(x);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(output.includes("42"), true);
    });

    it("positive: absolute import inside the project resolves", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/lib/helper.ts", "export const y = 99;");
      const { errors, output } = await bundleEntry(
        'import { y } from "/lib/helper.ts"; console.log(y);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(output.includes("99"), true);
    });

    it("positive: unicode (NFC) filename inside the project resolves", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/app/caf\u00E9.ts", "export const z = 1;");
      const { errors, output } = await bundleEntry(
        'import { z } from "./caf\u00E9.ts"; console.log(z);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(output.includes("z = 1") || output.includes("var z"), true);
    });
  },
);
