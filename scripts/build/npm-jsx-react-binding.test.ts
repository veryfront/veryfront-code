import { assertEquals, assertRejects } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  findFreeReactReference,
  normalizeNpmJsxReactBinding,
  withReactBinding,
} from "./npm-jsx-react-binding.ts";

/** The exact shape dnt emitted for the builtin popover in `0.1.1246`. */
const BROKEN_POPOVER = [
  "/** @module react/components/ui/adapter/builtin/popover */",
  'import { createAnchoredSurfaceParts } from "../../anchored-surface.js";',
  "const parts = createAnchoredSurfaceParts();",
  "export const builtinPopover = {",
  "    Root: parts.AnchoredRoot,",
  '    Trigger: (props) => React.createElement(parts.AnchoredTrigger, { haspopup: "dialog", ...props }),',
  "};",
].join("\n");

/** Same defect as BROKEN_POPOVER, but with no imports so it can be executed. */
const BROKEN_POPOVER_STANDALONE = [
  "export function render() {",
  '    return React.createElement("div") ? "ok" : "no";',
  "}",
].join("\n");

describe("findFreeReactReference", () => {
  it("flags the emitted builtin popover from the broken release", () => {
    assertEquals(findFreeReactReference(BROKEN_POPOVER), 6);
  });

  it("reports the first free reference when a module has several", () => {
    const source = [
      "export const a = () => React.createElement('span');",
      "export const b = () => React.createElement('div');",
    ].join("\n");

    assertEquals(findFreeReactReference(source), 1);
  });

  it("passes a module that imports the React namespace", () => {
    assertEquals(
      findFreeReactReference(withReactBinding(BROKEN_POPOVER)),
      undefined,
    );
  });

  it("passes a module that imports React as a default", () => {
    const source = 'import React from "react";\nReact.createElement("div");';

    assertEquals(findFreeReactReference(source), undefined);
  });

  it("passes a module that never mentions React", () => {
    assertEquals(findFreeReactReference('export const a = "b";'), undefined);
  });

  // `snippet-renderer.js` binds React this way. Re-importing over it would be
  // wrong, so a destructured binding has to count.
  it("passes a React bound by array destructuring", () => {
    const source = [
      "async function render() {",
      "    const [{ renderToString }, React] = await Promise.all([",
      '        import("react-dom/server"),',
      '        import("react"),',
      "    ]);",
      "    return renderToString(React.createElement('div'));",
      "}",
    ].join("\n");

    assertEquals(findFreeReactReference(source), undefined);
  });

  it("passes a reference the enclosing function's parameter binds", () => {
    const source =
      'export function mount(React) { React.createElement("div"); }';

    assertEquals(findFreeReactReference(source), undefined);
  });

  // Both shapes ship in the real package: `esm-module-loader/constants.js`
  // exports the esbuild factory names, and the dev-ui extension embeds a whole
  // browser bundle as one string.
  it("ignores React.createElement inside a string literal", () => {
    const source = 'export const FACTORY = "React.createElement";';

    assertEquals(findFreeReactReference(source), undefined);
  });

  it("ignores React.createElement inside a comment", () => {
    const source =
      "// lowered to React.createElement by the build\nexport const a = 1;";

    assertEquals(findFreeReactReference(source), undefined);
  });

  it("ignores an identifier that merely begins with React", () => {
    const source = "export const ReactVersion = 19;";

    assertEquals(findFreeReactReference(source), undefined);
  });

  // A binding only shadows its own scope. `snippet-renderer.js` binds React
  // inside one function; that must not excuse a free reference at module scope
  // elsewhere in the same file, or the module ships and throws.
  it("flags a module-scope reference that a function-local React does not bind", () => {
    const source = [
      'export const Card = (props) => React.createElement("div", props);',
      "async function render() {",
      "    const [{ renderToString }, React] = await Promise.all([",
      '        import("react-dom/server"),',
      '        import("react"),',
      "    ]);",
      '    return renderToString(React.createElement("span"));',
      "}",
    ].join("\n");

    assertEquals(findFreeReactReference(source), 1);
  });

  it("flags a reference a nested block's binding does not reach", () => {
    const source = [
      'React.createElement("div");',
      "{",
      "    const React = globalThis.React;",
      '    React.createElement("span");',
      "}",
    ].join("\n");

    assertEquals(findFreeReactReference(source), 1);
  });

  it("does not flag a reference a parameter binds", () => {
    const source = [
      "export function mount(React) {",
      "    return function inner() {",
      '        return React.createElement("div");',
      "    };",
      "}",
    ].join("\n");

    assertEquals(findFreeReactReference(source), undefined);
  });

  // Any read counts, not just `React.x` — the classic factory is what dnt emits
  // today, but a free `React` is a ReferenceError whatever shape it takes.
  it("flags an optional member access", () => {
    assertEquals(
      findFreeReactReference('export const a = React?.createElement("div");'),
      1,
    );
  });

  it("flags a computed member access", () => {
    assertEquals(
      findFreeReactReference('export const a = React["createElement"]("div");'),
      1,
    );
  });

  it("flags a bare React passed as a value", () => {
    assertEquals(findFreeReactReference("register(React);"), 1);
  });

  it("does not flag React as a property or an object key", () => {
    const source = [
      "export const key = { React: 1 };",
      "export const read = namespace.React;",
    ].join("\n");

    assertEquals(findFreeReactReference(source), undefined);
  });

  it("names the file when a module cannot be parsed", () => {
    const error = (() => {
      try {
        findFreeReactReference("export const = ;", "esm/src/broken.js");
        return undefined;
      } catch (caught) {
        return caught as Error;
      }
    })();

    assertEquals(error?.message.includes("esm/src/broken.js"), true);
  });
});

describe("normalizeNpmJsxReactBinding", () => {
  async function withTree(
    files: Record<string, string>,
    run: (root: string) => Promise<void>,
  ): Promise<void> {
    const root = await Deno.makeTempDir();
    try {
      for (const [name, contents] of Object.entries(files)) {
        const path = `${root}/${name}`;
        await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), {
          recursive: true,
        });
        await Deno.writeTextFile(path, contents);
      }
      await run(root);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }

  it("patches only the modules that need it", async () => {
    await withTree({
      "src/popover.js": BROKEN_POPOVER,
      "src/fine.js":
        'import * as React from "react";\nReact.createElement("div");',
      "src/plain.js": 'export const a = "b";',
    }, async (root) => {
      assertEquals(await normalizeNpmJsxReactBinding(root), ["src/popover.js"]);

      const patched = await Deno.readTextFile(`${root}/src/popover.js`);
      assertEquals(
        patched.startsWith('import * as React from "react";\n'),
        true,
      );
      assertEquals(findFreeReactReference(patched), undefined);

      // Untouched files are byte-identical.
      assertEquals(
        await Deno.readTextFile(`${root}/src/plain.js`),
        'export const a = "b";',
      );
    });
  });

  it("is idempotent, so a second build does not stack imports", async () => {
    await withTree({ "src/popover.js": BROKEN_POPOVER }, async (root) => {
      assertEquals(await normalizeNpmJsxReactBinding(root), ["src/popover.js"]);
      assertEquals(await normalizeNpmJsxReactBinding(root), []);

      const patched = await Deno.readTextFile(`${root}/src/popover.js`);
      assertEquals(
        patched.split("\n").filter((l) => l.includes('from "react"')).length,
        1,
      );
    });
  });

  it("leaves vendored deps/ alone", async () => {
    await withTree({
      "deps/esm.sh/react.js": 'export const x = React.createElement("div");',
    }, async (root) => {
      assertEquals(await normalizeNpmJsxReactBinding(root), []);
      assertEquals(
        (await Deno.readTextFile(`${root}/deps/esm.sh/react.js`)).startsWith(
          "export",
        ),
        true,
      );
    });
  });

  it("only rewrites JavaScript, not the declarations beside it", async () => {
    await withTree({
      "src/popover.js": BROKEN_POPOVER,
      "src/popover.d.ts": "export declare const builtinPopover: unknown;",
    }, async (root) => {
      await normalizeNpmJsxReactBinding(root);
      assertEquals(
        await Deno.readTextFile(`${root}/src/popover.d.ts`),
        "export declare const builtinPopover: unknown;",
      );
    });
  });

  it("leaves a module whose module-scope binding is not an import", async () => {
    // Nothing here needs fixing: the module already declares `React` at module
    // scope, so prepending an import would be a duplicate declaration rather
    // than a fix. Whether that binding is any good is the module's business.
    const source = 'const React = undefined;\nReact.createElement("div");';
    await withTree({ "src/bound.js": source }, async (root) => {
      assertEquals(await normalizeNpmJsxReactBinding(root), []);
      assertEquals(await Deno.readTextFile(`${root}/src/bound.js`), source);
    });
  });

  // The checker can only claim a module has a React binding. Whether the
  // rewritten file actually loads is a different property and one it cannot
  // establish -- a duplicate declaration parses fine and dies at load. So load
  // it for real, in a subprocess, with `react` mapped to a stub.
  it("produces a module that really loads and runs", async () => {
    await withTree({
      "src/popover.js": BROKEN_POPOVER_STANDALONE,
      "react-stub.js": "export function createElement() { return true; }",
      "import-map.json": JSON.stringify({
        imports: { react: "./react-stub.js" },
      }),
    }, async (root) => {
      assertEquals(await normalizeNpmJsxReactBinding(root), ["src/popover.js"]);

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--quiet",
          "--no-lock",
          `--import-map=${root}/import-map.json`,
          "--allow-read",
          `${root}/entry.js`,
        ],
        stdout: "piped",
        stderr: "piped",
      });
      await Deno.writeTextFile(
        `${root}/entry.js`,
        'import { render } from "./src/popover.js";\nconsole.log(render());\n',
      );

      const { code, stdout, stderr } = await command.output();
      const decode = (bytes: Uint8Array) =>
        new TextDecoder().decode(bytes).trim();
      assertEquals(
        code,
        0,
        `patched module failed to load: ${decode(stderr)}`,
      );
      assertEquals(decode(stdout), "ok");
    });
  });

  it("does not turn a hoisted `var React` into a duplicate declaration", async () => {
    // `var` hoists out of its block, so prepending an import beside it would
    // make the module unloadable -- a failure the post-rewrite scan cannot see,
    // because by then the import itself satisfies the check.
    const source = [
      'export function read() { return React.createElement("div"); }',
      "if (globalThis.x) { var React = globalThis.React; }",
    ].join("\n");

    await withTree({ "src/hoisted.js": source }, async (root) => {
      assertEquals(await normalizeNpmJsxReactBinding(root), []);
      assertEquals(await Deno.readTextFile(`${root}/src/hoisted.js`), source);
    });
  });

  it("reports a parse failure rather than passing the file through", async () => {
    await withTree({ "src/broken.js": "export const = ;" }, async (root) => {
      await assertRejects(
        () => normalizeNpmJsxReactBinding(root),
        Error,
        "src/broken.js",
      );
    });
  });
});
