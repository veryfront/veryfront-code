import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractImports, processImports, resolveImportPath } from "./import-utils.ts";

describe("build/renderer/utils/import-utils", () => {
  describe("extractImports", () => {
    it("should extract named imports", () => {
      assertEquals(extractImports('import { useState } from "react";'), ["react"]);
    });

    it("should extract default imports", () => {
      assertEquals(extractImports('import React from "react";'), ["react"]);
    });

    it("extracts combined default imports", () => {
      for (
        const code of [
          'import Child, { meta } from "./child.mdx";',
          'import Child, * as child from "./child.mdx";',
        ]
      ) {
        assertEquals(extractImports(code, { markdownCode: true }), ["./child.mdx"]);
      }
    });

    it("should extract namespace imports", () => {
      assertEquals(extractImports('import * as path from "path";'), ["path"]);
    });

    it("should extract side-effect imports", () => {
      assertEquals(extractImports('import "./styles.css";'), ["./styles.css"]);
    });

    it("should extract dynamic imports", () => {
      assertEquals(extractImports('const mod = import("./lazy.ts");'), ["./lazy.ts"]);
    });

    it("extracts dynamic imports with options", () => {
      for (
        const code of [
          '{import("./child.mdx", {})}',
          '{import("./child.mdx", { with: { type: "json" } })}',
        ]
      ) {
        assertEquals(extractImports(code, { markdownCode: true }), ["./child.mdx"]);
      }
    });

    it("keeps indented dynamic imports inside MDX flow expressions", () => {
      assertEquals(
        extractImports('{\n\n    import("./child.mdx")\n}', { markdownCode: true }),
        ["./child.mdx"],
      );
      assertEquals(
        extractImports('Result: {\n\n    import("./prose-child.mdx")\n}', {
          markdownCode: true,
        }),
        ["./prose-child.mdx"],
      );
    });

    it("keeps list-continuation expressions executable after blank lines", () => {
      for (
        const code of [
          '- item\n\n    {import("./child.mdx")}',
          '-   item\n\n      {import("./child.mdx")}',
          '-\titem\n\n      {import("./child.mdx")}',
        ]
      ) {
        assertEquals(
          extractImports(code, { markdownCode: true }),
          ["./child.mdx"],
        );
      }
    });

    it("ends list continuation when its blockquote container ends", () => {
      assertEquals(
        extractImports('> - item\n\n    {import("./missing.js")}', {
          markdownCode: true,
        }),
        [],
      );
    });

    it("ends list continuation after two blank lines", () => {
      assertEquals(
        extractImports('- item\n\n\n    {import("./missing.js")}', {
          markdownCode: true,
        }),
        [],
      );
    });

    it("ignores dynamic-import syntax in ordinary MDX prose", () => {
      assertEquals(
        extractImports('Use import("./missing.js") to load a module.', {
          markdownCode: true,
        }),
        [],
      );
    });

    it("classifies a long MDX prose line without treating it as JavaScript", () => {
      const prose = `${"word ".repeat(20_000)}import("./missing.js")`;
      assertEquals(extractImports(prose, { markdownCode: true }), []);
    });

    it("does not treat prose URLs as JavaScript line comments", () => {
      assertEquals(
        extractImports('See https://example.com {import("./child.mdx")}', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("keeps prose code spans separate from MDX expressions", () => {
      assertEquals(
        extractImports(
          '`{ import("./example.mdx") }` {\n  // import("./comment.mdx")\n  import("./real.mdx")\n}',
          { markdownCode: true },
        ),
        ["./real.mdx"],
      );
    });

    it("does not open inline code spans at escaped backticks", () => {
      assertEquals(
        extractImports('\\` {import("./child.mdx")} `later`', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("keeps JavaScript template expressions inside MDX flow expressions", () => {
      assertEquals(
        extractImports('{`${import("./child.mdx")}`}', { markdownCode: true }),
        ["./child.mdx"],
      );
      assertEquals(
        extractImports('{`${/}/.test(value) && import("./regex-child.mdx")}`}', {
          markdownCode: true,
        }),
        ["./regex-child.mdx"],
      );
      assertEquals(
        extractImports('{`import("./example.mdx")`}', { markdownCode: true }),
        [],
      );
      assertEquals(
        extractImports('{`${`}`}${import("./nested-template-child.mdx")}`}', {
          markdownCode: true,
        }),
        ["./nested-template-child.mdx"],
      );
    });

    it("keeps imports after regex quotes inside MDX flow expressions", () => {
      assertEquals(
        extractImports('{/"/.test(value) && import("./regex-quote-child.mdx")}', {
          markdownCode: true,
        }),
        ["./regex-quote-child.mdx"],
      );
    });

    it("keeps imports after regex literals preceded by block comments", () => {
      assertEquals(
        extractImports(
          '{(() => { return /* note */ /"/.test(value); return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("carries expression context into line-leading object literals", () => {
      assertEquals(
        extractImports(
          '{(() => { const ratio =\n{} / value; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("carries multiline arrow bodies into brace classification", () => {
      assertEquals(
        extractImports(
          '{(() => { const ratio = (() =>\n{}) / value; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("carries multiline class expression context into brace classification", () => {
      assertEquals(
        extractImports(
          '{(() => { const ratio = class\n{} / value; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("keeps imports after statement-position regex literals", () => {
      for (
        const [statement, child] of [
          ['if (enabled) /"/.test(value);', "if"],
          ['if (enabled) run(); else /"/.test(value);', "else"],
          ['do /"/.test(value); while (enabled);', "do"],
          ['if (enabled) {} /"/.test(value);', "block"],
          ['try {} catch {} /"/.test(value);', "catch"],
        ] as const
      ) {
        assertEquals(
          extractImports(
            `{(() => { ${statement} return import("./${child}-child.mdx"); })()}`,
            { markdownCode: true },
          ),
          [`./${child}-child.mdx`],
        );
      }
    });

    it("recognizes labeled statement blocks in regex context", () => {
      for (
        const code of [
          '{(() => { label: {} /"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { label:\n{}\n/"/.test(value); return import("./child.mdx"); })()}',
        ]
      ) {
        assertEquals(extractImports(code, { markdownCode: true }), ["./child.mdx"]);
      }
    });

    it("recognizes case-clause statement blocks in regex context", () => {
      assertEquals(
        extractImports(
          '{(() => { switch (value) { case 1: {} /"/.test(value); break; } return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("distinguishes function-expression bodies from statement blocks", () => {
      assertEquals(
        extractImports(
          '{(() => { const ratio = function() {} / value; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("distinguishes class-expression bodies from statement blocks", () => {
      assertEquals(
        extractImports(
          '{(() => { const ratio = class {} / value; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("keeps division after postfix updates and member-property keywords", () => {
      for (
        const code of [
          '{(() => { const ratio = value++ / divisor; return import("./child.mdx"); })()}',
          '{(() => { value++\n{}\n/"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { const ratio = object.return / divisor; return import("./child.mdx"); })()}',
          '{(() => { const ratio = object?.return / divisor; return import("./child.mdx"); })()}',
        ]
      ) {
        assertEquals(extractImports(code, { markdownCode: true }), ["./child.mdx"]);
      }
    });

    it("recognizes regex operands after spread syntax", () => {
      assertEquals(
        extractImports(
          '{(() => { const values = [.../"/]; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("starts line-leading regexes after restricted statements", () => {
      for (const statement of ["break", "continue", "debugger"]) {
        assertEquals(
          extractImports(
            `{(() => { ${statement}\n/"/.test(value); return import("./${statement}.mdx"); })()}`,
            { markdownCode: true },
          ),
          [`./${statement}.mdx`],
        );
      }
    });

    it("recognizes regex literals after class extends", () => {
      for (
        const code of [
          '{(() => { class Matcher extends /"/.constructor { static child = import("./child.mdx") }; return Matcher })()}',
          'export class Matcher extends /"/.constructor { static child = import("./child.mdx") }',
        ]
      ) {
        assertEquals(extractImports(code, { markdownCode: true }), ["./child.mdx"]);
      }
    });

    it("ignores regex parentheses while finding control-flow closes", () => {
      assertEquals(
        extractImports(
          '{(() => { if (/\\)/.test(value)) /"/.test(value); return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("carries split control-flow keywords into regex classification", () => {
      assertEquals(
        extractImports(
          '{(() => { if\n(ok)\n/"/.test(value); return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("ignores comments before control-flow conditions", () => {
      assertEquals(
        extractImports(
          '{(() => { if /* note */ (ok) /"/.test(value); return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("carries multiline control-flow delimiters into regex classification", () => {
      assertEquals(
        extractImports(
          '{(() => { if (\nok)\n/"/.test(value); return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("carries statement-block regex context across MDX expression lines", () => {
      assertEquals(
        extractImports(
          '{(() => { if (ok) {\nrun();\n}\n/"/.test(value); return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("does not treat fence-like JavaScript template text as Markdown code", () => {
      assertEquals(
        extractImports('{`\n~~~\n${import("./expression-child.mdx")}\n~~~\n`}', {
          markdownCode: true,
        }),
        ["./expression-child.mdx"],
      );
      assertEquals(
        extractImports(
          'export const child = `\n~~~\n${import("./esm-child.mdx")}\n~~~\n`',
          { markdownCode: true },
        ),
        ["./esm-child.mdx"],
      );
    });

    it("keeps dynamic imports in MDX ESM declarations", () => {
      assertEquals(
        extractImports('export const child = import("./esm-child.mdx")', {
          markdownCode: true,
        }),
        ["./esm-child.mdx"],
      );
    });

    it("recognizes comments between export and its declaration", () => {
      assertEquals(
        extractImports('export /* note */ const child = import("./child.mdx")', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("keeps dynamic imports on MDX ESM continuation lines", () => {
      assertEquals(
        extractImports('export const child =\n\n  import("./esm-child.mdx")', {
          markdownCode: true,
        }),
        ["./esm-child.mdx"],
      );
      for (
        const [operator, name] of [
          ["await", "await"],
          ["delete", "delete"],
          ["new", "new"],
          ["typeof", "typeof"],
          ["void", "void"],
          ["!", "not"],
          ["~", "bitwise-not"],
        ] as const
      ) {
        assertEquals(
          extractImports(
            `export const child = ${operator}\n  import("./${name}-child.mdx")`,
            { markdownCode: true },
          ),
          [`./${name}-child.mdx`],
        );
      }
    });

    it("continues MDX ESM after declaration keywords", () => {
      assertEquals(
        extractImports('export const\nchild = import("./child.mdx")', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
      assertEquals(
        extractImports(
          'export default function\nContent() { return import("./function-child.mdx") }',
          { markdownCode: true },
        ),
        ["./function-child.mdx"],
      );
      assertEquals(
        extractImports(
          'export async function\nload(value = import("./async-child.mdx")) {}',
          { markdownCode: true },
        ),
        ["./async-child.mdx"],
      );
    });

    it("distinguishes line-leading division from regular expressions in MDX ESM", () => {
      assertEquals(
        extractImports(
          'export const ratio = numerator\n  / (await import("./child.mdx")).value',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
      assertEquals(
        extractImports(
          'export const pattern =\n  /import("./not-a-dependency.mdx")/',
          { markdownCode: true },
        ),
        [],
      );
      assertEquals(
        extractImports(
          'export default\n  /import("./also-not-a-dependency.mdx")/',
          { markdownCode: true },
        ),
        [],
      );
    });

    it("preserves slash context across MDX expression lines", () => {
      assertEquals(
        extractImports(
          '{numerator\n  / /}/.test(value) && import("./child.mdx")}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
      assertEquals(
        extractImports(
          '{(() => { const ratio = (() =>\n{}) / value; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("ignores trailing comments when carrying regex context", () => {
      assertEquals(
        extractImports(
          'if (ok) // note\n  /"/.test(value); import("./child.mdx")',
        ),
        ["./child.mdx"],
      );
    });

    it("finds every static declaration on an MDX ESM line", () => {
      assertEquals(
        extractImports(
          'import A from "./a.js"; import Child from "./child.mdx"',
          { markdownCode: true },
        ),
        ["./a.js", "./child.mdx"],
      );
    });

    it("finds static imports split after the import keyword", () => {
      assertEquals(
        extractImports('import\nChild from "./child.mdx"', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("finds import and export clauses split before from", () => {
      for (
        const code of [
          'import Child\nfrom "./child.mdx"',
          'import { Child }\nfrom "./child.mdx"',
          'export { Child }\nfrom "./child.mdx"',
        ]
      ) {
        assertEquals(extractImports(code, { markdownCode: true }), ["./child.mdx"]);
      }
    });

    it("does not treat method calls named from as module specifiers", () => {
      assertEquals(
        extractImports('export const values = Array.from("./child.mdx")', {
          markdownCode: true,
        }),
        [],
      );
    });

    it("finds imports in exports split after the export keyword", () => {
      assertEquals(
        extractImports('export\nconst child = import("./dynamic-child.mdx")', {
          markdownCode: true,
        }),
        ["./dynamic-child.mdx"],
      );
      assertEquals(
        extractImports('export\n* from "./static-child.mdx"', {
          markdownCode: true,
        }),
        ["./static-child.mdx"],
      );
    });

    it("does not treat a standalone import paragraph as MDX ESM", () => {
      assertEquals(
        extractImports(
          'import\n\nThis prose mentions import("./not-a-dependency.mdx")',
          { markdownCode: true },
        ),
        [],
      );
    });

    it("keeps indented dynamic imports inside MDX JSX expressions", () => {
      assertEquals(
        extractImports('<Widget>{\n\n    import("./child.mdx")\n}</Widget>', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
      assertEquals(
        extractImports('<Widget prop={\n\n    import("./prop.mdx")\n} />', {
          markdownCode: true,
        }),
        ["./prop.mdx"],
      );
      assertEquals(
        extractImports('<Widget\n  prop={\n\n    import("./multiline-prop.mdx")\n}>', {
          markdownCode: true,
        }),
        ["./multiline-prop.mdx"],
      );
      assertEquals(
        extractImports(
          '<Widget label="{not an expression}" />\n\n    import("./example.mdx")',
          { markdownCode: true },
        ),
        [],
      );
    });

    it("keeps imports after JSX closing tags inside MDX expressions", () => {
      assertEquals(
        extractImports('{true ? <span></span> : import("./child.mdx")}', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("keeps dynamic imports inside multiline MDX JSX attribute expressions", () => {
      assertEquals(
        extractImports(
          '<Widget\n  prop={\n\n    import("./child.mdx")\n}>',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("does not treat JSX attribute backticks as Markdown code delimiters", () => {
      assertEquals(
        extractImports(
          '<Widget label="`" child={import("./child.mdx")} />\n\n`later`',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("closes JSX attribute quotes after literal backslashes", () => {
      assertEquals(
        extractImports(
          String.raw`<Widget label="value\" child={import("./double-child.mdx")} />`,
          { markdownCode: true },
        ),
        ["./double-child.mdx"],
      );
      assertEquals(
        extractImports(
          String.raw`<Widget label='value\' child={import("./single-child.mdx")} />`,
          { markdownCode: true },
        ),
        ["./single-child.mdx"],
      );
    });

    it("keeps dynamic import specifiers after unbounded whitespace", () => {
      assertEquals(
        extractImports(`{import(${" ".repeat(200)}"./child.mdx")}`, {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("should extract named and star re-export sources", () => {
      assertEquals(
        extractImports(
          'export { value } from "./named.js";\nexport * from "./all.js";\nexport * as ns from "./namespace.js";',
        ),
        ["./named.js", "./all.js", "./namespace.js"],
      );
    });

    it("extracts re-exports whose string-named export contains a brace", () => {
      assertEquals(
        extractImports('export { default as "}" } from "./child.mdx";', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("ignores imports and re-exports in fenced examples and comments", () => {
      assertEquals(
        extractImports(
          '```js\nexport { value } from "./fenced.js";\n```\n' +
            '<!-- import "./html-comment.js" -->\n' +
            '/* export * from "./block-comment.js"; */\n' +
            'import value from "./real.js";',
        ),
        ["./real.js"],
      );
    });

    it("does not open backtick fences whose info string contains a backtick", () => {
      assertEquals(
        extractImports('```js `invalid`\n{import("./child.mdx")}', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("ignores dynamic imports in blockquoted fenced examples", () => {
      assertEquals(
        extractImports(
          '> ```js\n> {import("./missing.js")}\n> ```\n' +
            '{import("./actual.mdx")}',
          { markdownCode: true },
        ),
        ["./actual.mdx"],
      );
    });

    it("ignores dynamic imports in blockquoted indented code", () => {
      assertEquals(
        extractImports(
          '>     {import("./missing.js")}\n>\n> Paragraph\n\n' +
            '-     {import("./list-missing.js")}\n\n' +
            '{import("./actual.mdx")}',
          { markdownCode: true },
        ),
        ["./actual.mdx"],
      );
    });

    it("ignores dynamic imports in list-nested tilde fences", () => {
      assertEquals(
        extractImports(
          '- ~~~js\n  {import("./missing.js")}\n  ~~~\n' +
            '{import("./actual.mdx")}',
          { markdownCode: true },
        ),
        ["./actual.mdx"],
      );
    });

    it("ends unclosed fenced code when its list container ends", () => {
      assertEquals(
        extractImports(
          '- ```\n  example\n{import("./child.mdx")}\n```',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("ends unclosed fenced code when its blockquote container ends", () => {
      assertEquals(
        extractImports('> ```\n{import("./child.mdx")}\n```', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("masks indented code immediately after headings", () => {
      assertEquals(
        extractImports('# Heading\n    {import("./missing.js")}', {
          markdownCode: true,
        }),
        [],
      );
    });

    it("masks indented code immediately after setext headings", () => {
      for (const underline of ["=======", "---"]) {
        assertEquals(
          extractImports(`Heading\n${underline}\n    {import("./missing.js")}`, {
            markdownCode: true,
          }),
          [],
        );
      }
    });

    it("tracks ordered-list continuation indentation for fenced examples", () => {
      assertEquals(
        extractImports(
          '10. item\n    ~~~js\n    {import("./missing.js")}\n    ~~~\n\n' +
            '{import("./actual.mdx")}',
          { markdownCode: true },
        ),
        ["./actual.mdx"],
      );
    });

    it("expands tabbed list continuation indentation after a blank line", () => {
      assertEquals(
        extractImports('- item\n\n\t{import("./child.mdx")}', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("does not treat ten-digit ordered markers as fence containers", () => {
      assertEquals(
        extractImports(
          '1234567890. ~~~\n{import("./child.mdx")}\n~~~',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("ignores imports and re-exports in inline code spans", () => {
      assertEquals(
        extractImports(
          '`export { value } from "./inline.js"` and ``import("./double.js")``\n' +
            'import value from "./real.js";',
          { markdownCode: true },
        ),
        ["./real.js"],
      );
    });

    it("ignores re-export syntax quoted inside ordinary MDX prose", () => {
      assertEquals(
        extractImports(
          'To re-export, use export { value } from "./missing.js".\n' +
            'export { actual } from "./actual.js";',
          { markdownCode: true },
        ),
        ["./actual.js"],
      );
    });

    it("resets unmatched prose quotes before later MDX imports", () => {
      assertEquals(
        extractImports('Don\'t forget.\n\nimport Child from "./child.mdx";', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("resets unmatched prose backticks before later MDX imports", () => {
      assertEquals(
        extractImports('Use `foo here.\n\nimport Child from "./child.mdx";', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("continues multiline MDX ESM when the next line starts with an operator", () => {
      assertEquals(
        extractImports(
          "export const child =\n" +
            "  enabled\n" +
            "    // Load only when enabled.\n" +
            "\n" +
            '    ? import("./child.mdx")\n' +
            "    : null",
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("preserves arithmetic operator-led ESM continuations without claiming Markdown lists", () => {
      for (const operator of ["+", "-", "*"]) {
        assertEquals(
          extractImports(
            `export const total = base\n  ${operator} (await import("./child.mdx")).value`,
            { markdownCode: true },
          ),
          ["./child.mdx"],
        );
      }

      assertEquals(
        extractImports(
          'import Actual from "./actual.js"\n\n- Use import("./missing.js") in prose',
          { markdownCode: true },
        ),
        ["./actual.js"],
      );
    });

    it("does not promote an HTML block after ESM into executable JavaScript", () => {
      assertEquals(
        extractImports(
          'import Actual from "./actual.js"\n\n<p>Use import("./missing.js") as an example.</p>',
          { markdownCode: true },
        ),
        ["./actual.js"],
      );
    });

    it("does not promote parenthesized prose after ESM into executable JavaScript", () => {
      assertEquals(
        extractImports(
          'import Actual from "./actual.js"\n\n' +
            '(Use import("./missing.js") as an example.)',
          { markdownCode: true },
        ),
        ["./actual.js"],
      );
    });

    it("continues tagged templates and escaped strings across ESM lines", () => {
      assertEquals(
        extractImports(
          'export const child = String.raw\n`${import("./tagged.mdx")}`',
          { markdownCode: true },
        ),
        ["./tagged.mdx"],
      );
      assertEquals(
        extractImports(
          'export const child = "prefix\\\nsuffix" && import("./escaped.mdx")',
          { markdownCode: true },
        ),
        ["./escaped.mdx"],
      );
    });

    it("preserves escaped strings across MDX expression lines", () => {
      assertEquals(
        extractImports(
          '{(() => { const value = "prefix\\\n}suffix"; return import("./child.mdx"); })()}',
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("advances across unmatched backtick runs and repeated control-flow regexes", () => {
      const backticks = "`".repeat(20_000);
      assertEquals(
        extractImports(`${backticks}\n\nimport Child from "./child.mdx"`, {
          markdownCode: true,
        }),
        [],
      );

      const regexStatements = "if (ok) /x/.test(value);".repeat(2_000);
      assertEquals(
        extractImports(`{${regexStatements} void import("./regex.mdx")}`, {
          markdownCode: true,
        }),
        ["./regex.mdx"],
      );
    });

    it("does not repeatedly scan ESM trivia after an open delimiter", () => {
      const comments = "// waiting for the operand\n".repeat(2_000);
      assertEquals(
        extractImports(
          `export const child = (\n${comments}import("./child.mdx")\n)`,
          { markdownCode: true },
        ),
        ["./child.mdx"],
      );
    });

    it("does not continue complete MDX ESM declarations into markdown blocks", () => {
      for (const marker of ["-", "+", "*", ">"] as const) {
        assertEquals(
          extractImports(
            'import Widget from "./widget.tsx"\n\n' +
              `${marker} prose import("./phantom-${marker.charCodeAt(0)}.mdx")`,
            { markdownCode: true },
          ),
          ["./widget.tsx"],
        );
      }

      assertEquals(
        extractImports(
          'import Widget from "./widget.tsx"\n\n---\nprose import("./phantom-rule.mdx")',
          { markdownCode: true },
        ),
        ["./widget.tsx"],
      );
    });

    it("ignores braces inside regular expressions in MDX flow expressions", () => {
      assertEquals(
        extractImports('{\n  const close = /\\}/;\n\n    import("./child.mdx")\n}', {
          markdownCode: true,
        }),
        ["./child.mdx"],
      );
    });

    it("ignores re-export syntax inside JavaScript strings", () => {
      assertEquals(
        extractImports(
          "const example = 'export { value } from \"./missing.js\"';\n" +
            'export { actual } from "./actual.js";',
        ),
        ["./actual.js"],
      );
    });

    it("should deduplicate imports", () => {
      const code = ['import { a } from "react";', 'import { b } from "react";'].join(
        "\n",
      );
      assertEquals(extractImports(code), ["react"]);
    });

    it("should extract multiple different imports", () => {
      const code = [
        'import React from "react";',
        'import { render } from "react-dom";',
        'import "./global.css";',
      ].join("\n");

      const imports = extractImports(code);

      assertEquals(imports.includes("react"), true);
      assertEquals(imports.includes("react-dom"), true);
      assertEquals(imports.includes("./global.css"), true);
    });

    it("should return empty for no imports", () => {
      assertEquals(extractImports("const x = 1;"), []);
    });
  });

  describe("resolveImportPath", () => {
    it("should resolve relative imports", () => {
      const result = resolveImportPath("./utils", "/project/src/app.ts", "/project");
      assertEquals(result.endsWith("/project/src/utils"), true);
    });

    it("should resolve parent relative imports", () => {
      const result = resolveImportPath(
        "../shared/lib",
        "/project/src/app.ts",
        "/project",
      );
      assertEquals(result.endsWith("/project/shared/lib"), true);
    });

    it("should return bare specifiers unchanged", () => {
      assertEquals(resolveImportPath("react", "/a/b.ts", "/a"), "react");
      assertEquals(resolveImportPath("lodash/get", "/a/b.ts", "/a"), "lodash/get");
    });

    it("should return absolute paths unchanged", () => {
      assertEquals(
        resolveImportPath("/absolute/path", "/a/b.ts", "/a"),
        "/absolute/path",
      );
    });

    it("should return URL-like paths unchanged", () => {
      assertEquals(
        resolveImportPath("https://cdn.example.com/lib.js", "/a/b.ts", "/a"),
        "https://cdn.example.com/lib.js",
      );
    });
  });

  describe("processImports", () => {
    it("should replace import paths using the processor", async () => {
      const code = 'import { helper } from "./utils";\nconsole.log(helper);';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async (importPath: string) => {
          if (importPath.includes("utils")) return "./utils/index.js";
          return null;
        },
      );
      assertEquals(result.includes("./utils/index.js"), true);
    });

    it("should leave imports unchanged when processor returns null", async () => {
      const code = 'import React from "react";';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => null,
      );
      assertEquals(result, code);
    });

    it("should leave imports unchanged when processor returns same path", async () => {
      const code = 'import { x } from "./same";';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => "./same",
      );
      assertEquals(result, code);
    });

    it("should handle code with no imports", async () => {
      const code = "const x = 1;";
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => "./replaced",
      );
      assertEquals(result, code);
    });

    it("rewrites only the quoted import specifier", async () => {
      const code = [
        'import { a } from "./mod";',
        'const s = "./mod-extra";',
        "// see ./mod for details",
      ].join("\n");
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async (importPath: string) => {
          if (importPath.endsWith("/mod")) return "./mod/index.js";
          return null;
        },
      );
      assertEquals(
        result,
        [
          'import { a } from "./mod/index.js";',
          'const s = "./mod-extra";',
          "// see ./mod for details",
        ].join("\n"),
        "only the quoted import specifier is rewritten; unrelated literals and comments are untouched",
      );
    });

    it("rewrites combined default imports", async () => {
      for (
        const code of [
          'import Child, { meta } from "./child.mdx";',
          'import Child, * as child from "./child.mdx";',
        ]
      ) {
        const result = await processImports(
          code,
          "/project/src/page.mdx",
          "/project",
          async () => "/bundled/child.js",
          { markdownCode: true },
        );
        assertEquals(result, code.replace("./child.mdx", "/bundled/child.js"));
      }
    });

    it("rewrites string-named re-exports containing braces", async () => {
      const code = 'export { default as "}" } from "./child.mdx";';
      const result = await processImports(
        code,
        "/project/src/page.mdx",
        "/project",
        async () => "/bundled/child.js",
        { markdownCode: true },
      );

      assertEquals(result, 'export { default as "}" } from "/bundled/child.js";');
    });

    it("does not rewrite matching specifiers inside fenced examples", async () => {
      const code = [
        'import { value } from "./mod";',
        "```js",
        'export { value } from "./mod";',
        "```",
      ].join("\n");
      const result = await processImports(
        code,
        "/project/src/page.mdx",
        "/project",
        async (importPath: string) => importPath.endsWith("/mod") ? "./mod.js" : null,
      );

      assertEquals(
        result,
        [
          'import { value } from "./mod.js";',
          "```js",
          'export { value } from "./mod";',
          "```",
        ].join("\n"),
      );
    });

    it("does not rewrite indented code after an ended list", async () => {
      const code = '- item\n\n\n    {import("./missing.js")}';
      let processorCalled = false;
      const result = await processImports(
        code,
        "/project/src/page.mdx",
        "/project",
        async () => {
          processorCalled = true;
          return "./rewritten.js";
        },
        { markdownCode: true },
      );

      assertEquals(result, code);
      assertEquals(processorCalled, false);
    });

    it("does not rewrite re-export syntax quoted in ordinary MDX prose", async () => {
      const code = 'To re-export, use export { value } from "./missing.js".';
      const result = await processImports(
        code,
        "/project/src/page.mdx",
        "/project",
        async () => "./rewritten.js",
        { markdownCode: true },
      );

      assertEquals(result, code);
    });

    it("does not resolve dynamic-import syntax in ordinary MDX prose", async () => {
      const code = 'Use import("./missing.js") to load a module.';
      let processorCalled = false;
      const result = await processImports(
        code,
        "/project/src/page.mdx",
        "/project",
        async () => {
          processorCalled = true;
          return "./rewritten.js";
        },
        { markdownCode: true },
      );

      assertEquals(result, code);
      assertEquals(processorCalled, false);
    });

    it("keeps an indented dynamic import inside an MDX expression active", async () => {
      const result = await processImports(
        '{\n    import("./runtime.js")\n}',
        "/project/page.mdx",
        "/project",
        async () => "/bundled/runtime.js",
        { markdownCode: true },
      );

      assertEquals(result, '{\n    import("/bundled/runtime.js")\n}');

      const multilineJsxResult = await processImports(
        '<Widget\n  prop={\n\n    import("./child.mdx")\n}>',
        "/project/page.mdx",
        "/project",
        async () => "/bundled/child.js",
        { markdownCode: true },
      );

      assertEquals(
        multilineJsxResult,
        '<Widget\n  prop={\n\n    import("/bundled/child.js")\n}>',
      );

      const proseExpressionResult = await processImports(
        'See https://example.com Result: {\n\n    import("./prose-child.mdx")\n}',
        "/project/page.mdx",
        "/project",
        async () => "/bundled/prose-child.js",
        { markdownCode: true },
      );

      assertEquals(
        proseExpressionResult,
        'See https://example.com Result: {\n\n    import("/bundled/prose-child.js")\n}',
      );
    });

    it("rewrites imports after multiline MDX scanner edge cases", async () => {
      for (
        const code of [
          '- item\n\n    {import("./child.mdx")}',
          '-   item\n\n      {import("./child.mdx")}',
          '-\titem\n\n      {import("./child.mdx")}',
          '- ```\n  example\n{import("./child.mdx")}\n```',
          '> ```\n{import("./child.mdx")}\n```',
          '{(() => { if (ok) {\nrun();\n}\n/"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { label: {} /"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { const ratio = function() {} / value; return import("./child.mdx"); })()}',
          '{(() => { const ratio = class {} / value; return import("./child.mdx"); })()}',
          '{(() => { const ratio = value++ / divisor; return import("./child.mdx"); })()}',
          '{(() => { const ratio = object.return / divisor; return import("./child.mdx"); })()}',
          '{(() => { const values = [.../"/]; return import("./child.mdx"); })()}',
          '{(() => { debugger\n/"/.test(value); return import("./child.mdx"); })()}',
          'export class Matcher extends /"/.constructor { static child = import("./child.mdx") }',
          '{(() => { if (/\\)/.test(value)) /"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { if\n(ok)\n/"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { if (\nok)\n/"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { if /* note */ (ok) /"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { return /* note */ /"/.test(value); return import("./child.mdx"); })()}',
          '{(() => { const ratio =\n{} / value; return import("./child.mdx"); })()}',
          '{(() => { const ratio = (() =>\n{}) / value; return import("./child.mdx"); })()}',
          `{import(${" ".repeat(200)}"./child.mdx")}`,
          '<Widget label="`" child={import("./child.mdx")} />\n\n`later`',
          'export /* note */ const child = import("./child.mdx")',
          'export const\nchild = import("./child.mdx")',
          'export async function\nload(value = import("./child.mdx")) {}',
          'import Child\nfrom "./child.mdx"',
          'import { Child }\nfrom "./child.mdx"',
          'export { Child }\nfrom "./child.mdx"',
          '{import("./child.mdx", { with: { type: "json" } })}',
          String.raw`<Widget label="value\" child={import("./child.mdx")} />`,
          String.raw`<Widget label='value\' child={import("./child.mdx")} />`,
        ]
      ) {
        const result = await processImports(
          code,
          "/project/page.mdx",
          "/project",
          async () => "/bundled/child.js",
          { markdownCode: true },
        );

        assertEquals(result.includes('"/bundled/child.js"'), true);
      }
    });

    it("does not rewrite method-call string arguments named from", async () => {
      const code = 'export const values = Array.from("./child.mdx")';
      let processorCalled = false;
      const result = await processImports(
        code,
        "/project/page.mdx",
        "/project",
        async () => {
          processorCalled = true;
          return "/bundled/child.js";
        },
        { markdownCode: true },
      );

      assertEquals(result, code);
      assertEquals(processorCalled, false);
    });

    it("should handle multiple imports", async () => {
      const code = [
        'import { a } from "./mod-a";',
        'import { b } from "./mod-b";',
      ].join("\n");
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async (importPath: string) => {
          if (importPath.includes("mod-a")) return "./new-mod-a";
          return null;
        },
      );
      assertEquals(result.includes("./new-mod-a"), true);
      assertEquals(result.includes("./mod-b"), true);
    });
  });
});
