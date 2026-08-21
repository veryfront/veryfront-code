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

  it("passes a React taken as a parameter", () => {
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

  it("ignores a React-prefixed identifier that is not a member access", () => {
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

  it("patches only the modules that need it, and makes them loadable", async () => {
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

  it("leaves a module that already binds React by other means alone", async () => {
    // A binding the rewrite cannot satisfy: the module shadows `React` with an
    // import of its own name, so prepending another one would be a duplicate
    // declaration rather than a fix. Detection must not claim success here.
    await withTree({
      "src/shadowed.js":
        'const React = undefined;\nReact.createElement("div");',
    }, async (root) => {
      // A local binding exists, so nothing is patched and nothing is reported.
      assertEquals(await normalizeNpmJsxReactBinding(root), []);
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
