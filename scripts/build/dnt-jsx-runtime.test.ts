import { build } from "#dnt";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { toFileUrl } from "#std/path";
import { NPM_DNT_COMPILER_OPTIONS } from "./dnt-compiler-options.ts";

describe("dnt JSX runtime", () => {
  it("emits JSX that loads without a global React binding", async () => {
    const root = await Deno.makeTempDir({ prefix: "veryfront-dnt-jsx-" });
    try {
      const sourcePath = `${root}/entry.tsx`;
      const outDir = `${root}/out`;
      await Deno.writeTextFile(
        sourcePath,
        'export function View() { return <div data-test="ok" />; }\n',
      );

      await build({
        entryPoints: [sourcePath],
        outDir,
        test: false,
        scriptModule: false,
        typeCheck: false,
        skipNpmInstall: true,
        shims: {},
        compilerOptions: NPM_DNT_COMPILER_OPTIONS,
        package: {
          name: "veryfront-dnt-jsx-fixture",
          version: "1.0.0",
        },
      });

      const emittedPath = `${outDir}/esm/entry.js`;
      const emitted = await Deno.readTextFile(emittedPath);
      assertStringIncludes(emitted, 'from "react/jsx-runtime"');
      assert(
        !emitted.includes("React.createElement"),
        "automatic JSX output must not require a global React binding",
      );

      const reactDir = `${outDir}/node_modules/react`;
      await Deno.mkdir(reactDir, { recursive: true });
      await Deno.writeTextFile(
        `${reactDir}/package.json`,
        JSON.stringify({
          name: "react",
          version: "0.0.0",
          type: "module",
          exports: { "./jsx-runtime": "./jsx-runtime.js" },
        }),
      );
      await Deno.writeTextFile(
        `${reactDir}/jsx-runtime.js`,
        "export function jsx(type, props) { return { type, props }; }\n",
      );

      const result = await new Deno.Command("node", {
        args: [
          "--input-type=module",
          "--eval",
          [
            "delete globalThis.React;",
            "const { View } = await import(process.argv[1]);",
            "const rendered = View();",
            'if (rendered.type !== "div" || rendered.props["data-test"] !== "ok") throw new Error("unexpected render result");',
          ].join(" "),
          toFileUrl(emittedPath).href,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(
        result.code,
        0,
        new TextDecoder().decode(result.stderr),
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});
