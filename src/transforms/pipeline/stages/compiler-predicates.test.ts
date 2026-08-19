/**
 * Differential tests for the predicates this stage uses to stand in for the
 * compiler.
 *
 * `reference-classification.test.ts` pins the node-type TABLE: it fails when
 * `@babel/types` gains a type nobody classified. It cannot fail when a
 * PREDICATE that approximates a compiler rule drifts from the compiler, because
 * the table says nothing about what the rule is supposed to be.
 *
 * Every test here compares a predicate against the thing it approximates,
 * measured on the real artifact, rather than against a second hand-written
 * expectation of the same rule. A hand-written expectation restates the
 * predicate and passes whether or not either one is right. Asking esbuild what
 * it emitted fails when the two disagree, whoever moved.
 *
 * The predicates covered, and the rule each one stands in for:
 *
 * | predicate | rule it approximates |
 * |---|---|
 * | `isIntrinsicJsxName` | esbuild's tag-text test for a JSX element name |
 * | `pragmaRootBinding`, `jsxPragmaBindings` | esbuild's classic JSX pragma parsing |
 * | `referenceClassOf`'s `declare` short-circuit | ambient declarations emit nothing |
 * | its `nodeHasDecorators` exception | a decorator on an ambient member still emits |
 * | its `importKind` / `exportKind` short-circuits | type-only elision |
 * | `RUNTIME_TS_NODE_TYPES` / the erased TypeScript list | TypeScript type erasure |
 * | `importedBindings`' type-specifier skip | type-only elision, same family |
 * | `compilerNameHelperBindings` | esbuild's `keepNames` helper shape |
 * | `SOURCE_MAP_SUFFIX` in the strip | esbuild's sourcemap comment |
 *
 * Three rules in this stage are deliberately not here, each for a different
 * reason.
 *
 * - `freeReferencedIdentifiers` and `patternBoundNames` approximate ECMAScript
 *   SCOPING. No compiler reports a scope resolution in its output: esbuild
 *   resolves scopes internally and the artifact never names the binding a
 *   reference resolved to, so there is no answer to compare against. Renaming
 *   under `minify` is the closest observable proxy and it is not the same
 *   question, because esbuild is free to rename or not. That pair is covered by
 *   behavioural fixtures in `browser-server-exports-strip.test.ts` instead.
 * - `retainLeadingComments` approximates the PARSER's comment attachment, not
 *   the compiler's. Its differential partner would be Babel, which is also the
 *   tool that produced the input, so a comparison would be circular. It is
 *   covered by `keeps a jsx pragma that sits above a removed import`.
 * - `SERVER_ONLY_EXPORTS` and `isKnownDroppableSource` are framework policy.
 *   Nothing outside this repository owns the rule, so there is nothing to be
 *   differential against.
 *
 * @module transforms/pipeline/stages/compiler-predicates.test
 */

import "#veryfront/schemas/_test-setup.ts";
import "../../plugins/__tests__/code-parser-setup.ts";
import { stop as stopEsbuild, transform } from "#veryfront/platform/compat/esbuild.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import { ESBUILD_SUPPORTED_FEATURES } from "../../esm/transform-utils.ts";
import { isEcmaScriptIdentifier, isIntrinsicJsxName } from "./reference-classification.ts";
import {
  jsxPragmaBindings,
  moduleReferenceWalkers,
  pragmaRootBinding,
  stripServerOnlyExports,
} from "./browser-server-exports-strip.ts";
import { runPipeline } from "../index.ts";

type Node = Record<string, unknown> & { type: string };

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

function parser(): CodeParser {
  const found = tryResolve<CodeParser>("CodeParser");
  if (!found) throw new Error("no CodeParser extension is registered");
  return found;
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) if (isNode(entry)) walk(entry, visit);
      continue;
    }
    if (isNode(value)) walk(value, visit);
  }
}

/**
 * The compile stage's own esbuild settings, minus minification and source maps.
 *
 * Kept equal to `compile.ts` in every field that decides what survives into the
 * artifact, so a verdict measured here is the verdict the pipeline gets.
 * `treeShaking` is off because the question is what the COMPILER erases, not
 * what the bundler later drops as unreachable.
 */
const COMPILE_OPTIONS = {
  format: "esm",
  target: "es2022",
  supported: ESBUILD_SUPPORTED_FEATURES,
  jsx: "automatic",
  jsxImportSource: "react",
  minify: false,
  sourcemap: false,
  treeShaking: false,
  keepNames: true,
} as const;

/* ------------------------------------------------------------------ *
 * Oracle 1: does the artifact treat a JSX element name as string text? *
 * ------------------------------------------------------------------ */

type ElementNameVerdict = "tag-text" | "binding-read" | "rejected";

/**
 * What esbuild emitted for `<name />`, read off the artifact.
 *
 * The classic runtime is used with a factory this fixture owns, so the emitted
 * call is unambiguous: `__vfFactory("div", null)` passed string text and
 * `__vfFactory(Card, null)` passed a binding. The first argument is read from
 * the parsed artifact rather than matched as text, because esbuild escapes
 * every non-ASCII code point in both positions (`"caf\xE9"` and `Café`)
 * and a text match cannot tell those apart.
 */
async function esbuildElementNameVerdict(name: string): Promise<ElementNameVerdict> {
  let code: string;
  try {
    const result = await transform(`<${name} />;`, {
      ...COMPILE_OPTIONS,
      loader: "jsx",
      jsx: "transform",
      jsxFactory: "__vfFactory",
    });
    code = result.code;
  } catch {
    return "rejected";
  }

  const ast = await parser().parse({ code, filePath: "artifact.js" });
  let verdict: ElementNameVerdict | null = null;
  walk(ast as unknown as Node, (node) => {
    if (verdict !== null || node.type !== "CallExpression") return;
    const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
    const first = args[0];
    if (!first) return;
    verdict = first.type === "StringLiteral" ? "tag-text" : "binding-read";
  });
  if (verdict === null) throw new Error(`no factory call in the artifact for <${name} />`);
  return verdict;
}

/** Whether the pipeline's parser accepts `name` as a bare JSX element name. */
async function parserAcceptsElementName(name: string): Promise<boolean> {
  try {
    await parser().parse({ code: `<${name} />;`, filePath: "page.tsx" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The corpus. Every entry is a name esbuild and the parser both accept, so the
 * differential assertion is meaningful for all of them. The two families where
 * the two tools disagree get their own tests below.
 */
const ELEMENT_NAMES: readonly string[] = [
  // ASCII lowercase: intrinsic tags, including the spellings that are not
  // identifiers at all.
  "div",
  "table",
  "a",
  "x1",
  "aB",
  "x-",
  "my-widget",
  "data-x",
  // ASCII uppercase: component references.
  "Card",
  "A",
  "X1",
  "AB",
  // `_` and `$` are identifier starts by convention, not by Unicode property.
  "_",
  "$",
  "_Card",
  "$Card",
  "_1",
  "$1",
  // Latin-1 accents. `café` is a valid identifier AND tag text, because the
  // ASCII-lowercase clause fires first; `Café` is a component.
  "café",
  "Café",
  "él",
  "Él",
  // A combining mark in an ID_Continue position, precomposed and decomposed.
  "é",
  "É",
  "X́",
  // Greek and Cyrillic: a lowercase letter that is not ASCII lowercase, so
  // esbuild reads a binding however the reader would pronounce the case.
  "Ωmega",
  "ωmega",
  "Привет",
  "привет",
  // CJK: no case at all.
  "日本語",
  "コンポーネント",
  // ID_Start code points outside the letter categories.
  "ℕat",
  "Ⅻ",
  "℘",
  // ZWJ and ZWNJ are permitted in ID_Continue positions and nowhere else.
  "A‍b",
  "A‌b",
];

/** Names neither tool accepts, so nothing in the pipeline can ever see them. */
const UNPARSEABLE_ELEMENT_NAMES: readonly string[] = [
  "\u{1F389}",
  "emoji\u{1F389}",
  "́x",
  "-x",
];

describe("compiler predicates, measured differentially", () => {
  afterAll(async () => {
    await stopEsbuild();
  });

  describe("isIntrinsicJsxName against esbuild", () => {
    for (const name of ELEMENT_NAMES) {
      it(`agrees with the artifact for <${name} />`, async () => {
        const verdict = await esbuildElementNameVerdict(name);
        assertEquals(
          verdict === "rejected",
          false,
          `esbuild rejected <${name} />, so this name belongs in another corpus`,
        );
        assertEquals(
          isIntrinsicJsxName(name),
          verdict === "tag-text",
          `esbuild emitted a ${verdict} for <${name} />`,
        );
      });
    }

    for (const name of UNPARSEABLE_ELEMENT_NAMES) {
      it(`is never asked about <${name} />, which neither tool parses`, async () => {
        assertEquals(await esbuildElementNameVerdict(name), "rejected");
        assertEquals(await parserAcceptsElementName(name), false);
      });
    }

    // The predicate has to be able to disagree with the artifact, or the loop
    // above proves nothing. This is the skew the ASCII-only spelling had.
    it("disagrees with the artifact when the identifier test is ASCII-only", async () => {
      const asciiOnly = (name: string) =>
        /^[a-z]/.test(name) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);

      const skewed: string[] = [];
      for (const name of ELEMENT_NAMES) {
        const verdict = await esbuildElementNameVerdict(name);
        if (asciiOnly(name) !== (verdict === "tag-text")) skewed.push(name);
      }

      assertEquals(skewed.length > 0, true, "the ASCII-only predicate must fail this corpus");
    });

    // The two tools do not have the same Unicode tables. Both directions are
    // recorded, because both are safe and neither is obvious.
    it("retains the binding for a code point newer than esbuild's tables", async () => {
      // U+1C8A, added in Unicode 14. The parser accepts it, esbuild does not,
      // so the module fails to compile with a diagnostic. The predicate must
      // still answer "binding read": the over-retaining direction leaves a
      // loud build error, and the other one would delete an import first.
      const name = "ᲊ";

      assertEquals(await parserAcceptsElementName(name), true);
      assertEquals(await esbuildElementNameVerdict(name), "rejected");
      assertEquals(isIntrinsicJsxName(name), false);
    });

    it("never sees an astral element name, which the parser rejects first", async () => {
      // U+1D49E. esbuild reads a binding here, but the parser refuses the name,
      // so the strip stage fails the build before the predicate is consulted.
      const name = "\u{1D49E}ard";

      assertEquals(await esbuildElementNameVerdict(name), "binding-read");
      assertEquals(await parserAcceptsElementName(name), false);
    });
  });

  describe("jsxPragmaBindings against esbuild", () => {
    /**
     * The bindings esbuild's artifact needs from the module, read off the
     * artifact.
     *
     * The fixture holds intrinsic tags and a fragment only, so every call in
     * the output is a JSX factory call. A factory root is free when the
     * artifact does not import it: under the automatic runtime esbuild writes
     * its own `jsx` import, and under the classic runtime it writes nothing and
     * the module has to provide the name.
     */
    async function esbuildFactoryRoots(pragma: string): Promise<string[]> {
      const source = `${pragma}\nexport const el = <div><span /></div>;\n` +
        `export const frag = <><em /></>;`;
      const { code } = await transform(source, { ...COMPILE_OPTIONS, loader: "tsx" });
      const ast = await parser().parse({ code, filePath: "artifact.js" });

      const imported = new Set<string>();
      const roots = new Set<string>();
      walk(ast as unknown as Node, (node) => {
        if (node.type === "ImportDeclaration") {
          for (const specifier of Array.isArray(node.specifiers) ? node.specifiers : []) {
            if (!isNode(specifier) || !isNode(specifier.local)) continue;
            const local = specifier.local.name;
            if (typeof local === "string") imported.add(local);
          }
          return;
        }
        if (node.type !== "CallExpression") return;
        const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
        // The callee is the factory. The first argument is the element, which
        // is a string for an intrinsic tag and the fragment binding for `<>`.
        for (const candidate of [node.callee, args[0]]) {
          const root = rootIdentifier(candidate);
          if (root) roots.add(root);
        }
      });

      return [...roots].filter((name) => !imported.has(name)).sort();
    }

    /** `React.createElement` and `React` both have the root `React`. */
    function rootIdentifier(value: unknown): string | null {
      let node = value;
      while (isNode(node) && node.type === "MemberExpression") node = node.object;
      if (!isNode(node) || node.type !== "Identifier") return null;
      return typeof node.name === "string" ? node.name : null;
    }

    /** What the strip pass pins for the same module. */
    async function pinnedBindings(pragma: string): Promise<string[]> {
      const source = `${pragma}\nexport const el = <div><span /></div>;\n` +
        `export const frag = <><em /></>;`;
      const ast = await parser().parse({ code: source, filePath: "page.tsx" });
      return [...jsxPragmaBindings(ast as ASTNode)].sort();
    }

    const PRAGMAS: readonly { label: string; text: string }[] = [
      { label: "no pragma", text: "" },
      { label: "an automatic-runtime import source", text: "/** @jsxImportSource preact */" },
      { label: "a factory without the classic runtime", text: "/** @jsx h */" },
      { label: "the classic runtime with no factory", text: "/** @jsxRuntime classic */" },
      {
        label: "an ASCII factory and fragment",
        text: "/** @jsxRuntime classic @jsx h @jsxFrag Fr */",
      },
      {
        label: "the runtime named after the factory",
        text: "/** @jsx h @jsxRuntime classic */",
      },
      {
        label: "the pragmas split across two line comments",
        text: "// @jsxRuntime classic\n// @jsx h",
      },
      {
        label: "a Latin-1 member factory",
        text: "/** @jsxRuntime classic @jsx \u0126.cr\u00E9ate @jsxFrag \u0126.Fr\u00E1gment */",
      },
      {
        label: "a Cyrillic member factory",
        text: "/** @jsxRuntime classic @jsx \u043A\u0440\u0435\u043E.\u044D\u043B\u0435\u043C */",
      },
      {
        label: "a CJK member factory",
        text: "/** @jsxRuntime classic @jsx \u65E5\u672C.\u8981\u7D20 */",
      },
      {
        label: "a factory that is not an expression at all",
        text: "/** @jsxRuntime classic @jsx \u{1F389} */",
      },
    ];

    for (const { label, text } of PRAGMAS) {
      it(`pins what the artifact calls, given ${label}`, async () => {
        const roots = await esbuildFactoryRoots(text);
        const pinned = await pinnedBindings(text);

        // Everything the artifact calls must survive the strip, or the page
        // dies on the factory. Nothing beyond that may be pinned except the
        // documented classic-runtime default, which is the fail-closed half.
        for (const root of roots) {
          assertEquals(
            pinned.includes(root),
            true,
            `the artifact calls ${root}, which is not pinned. pinned: ${pinned.join(", ")}`,
          );
        }
        for (const name of pinned) {
          assertEquals(
            roots.includes(name) || name === "React",
            true,
            `${name} is pinned but the artifact never calls it`,
          );
        }
      });
    }

    // The skew check for this predicate: with the ASCII-only identifier test,
    // the non-ASCII factories stop being pinned and the corpus fails.
    it("stops pinning a non-ASCII factory when the identifier test is ASCII-only", () => {
      const ascii = (expression: string): string | null => {
        const root = expression.split(/[.([]/)[0]?.trim();
        return root && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root) ? root : null;
      };

      assertEquals(pragmaRootBinding("\u0126.cr\u00E9ate"), "\u0126");
      assertEquals(ascii("\u0126.cr\u00E9ate"), null);
    });
  });

  describe("TypeScript erasure against esbuild", () => {
    /**
     * Whether the artifact still needs `Probe`.
     *
     * Every fixture imports `Probe` and uses it in exactly one position. Under
     * the `tsx` loader esbuild deletes an import whose bindings only appear in
     * erased positions, so the presence of the import in the artifact is the
     * compiler's own answer to "is this a value read?". Tree shaking is off, so
     * the only thing that can remove it is type erasure.
     */
    async function esbuildKeepsProbe(source: string): Promise<boolean> {
      const { code } = await transform(source, { ...COMPILE_OPTIONS, loader: "tsx" });
      return code.includes(PROBE_MODULE);
    }

    /** What each walker attributes to runtime code for the same module. */
    async function walkerReadsProbe(source: string): Promise<{ flat: boolean; scoped: boolean }> {
      const ast = await parser().parse({ code: source, filePath: "page.tsx" });
      const { referenced, free } = moduleReferenceWalkers(ast as ASTNode);
      return { flat: referenced.has(PROBE), scoped: free.has(PROBE) };
    }

    const PROBE = "Probe";
    const PROBE_MODULE = "./probe.ts";
    const IMPORT = `import { ${PROBE} } from "${PROBE_MODULE}";`;

    /**
     * One fixture per predicate the classification applies to a TypeScript
     * construct. The expected answer is not written down: esbuild is asked.
     */
    const TS_FIXTURES: readonly { label: string; source: string }[] = [
      { label: "a plain value read", source: `${IMPORT}\nexport const a = Probe;` },
      { label: "a JSX element name", source: `${IMPORT}\nexport const el = <Probe />;` },
      { label: "a parameter type", source: `${IMPORT}\nexport function f(p: Probe) { return p; }` },
      { label: "a `typeof` query", source: `${IMPORT}\nexport type A = typeof Probe;` },
      { label: "a variable type", source: `${IMPORT}\nexport let a: Probe;` },
      // The importKind and exportKind short-circuits.
      {
        label: "an inline type import specifier",
        source: `import { type ${PROBE} } from "${PROBE_MODULE}";\nexport type A = Probe;`,
      },
      {
        label: "a type-only import statement",
        source: `import type { ${PROBE} } from "${PROBE_MODULE}";\nexport type A = Probe;`,
      },
      { label: "a value re-export", source: `${IMPORT}\nexport { Probe };` },
      { label: "an inline type export specifier", source: `${IMPORT}\nexport { type Probe };` },
      { label: "a type-only export statement", source: `${IMPORT}\nexport type { Probe };` },
      // The `declare` short-circuit.
      {
        label: "an ambient constant",
        source: `${IMPORT}\ndeclare const cfg: typeof Probe;\nexport const a = 1;`,
      },
      {
        label: "an ambient class heritage clause",
        source: `${IMPORT}\ndeclare class C extends Probe {}\nexport const a = 1;`,
      },
      {
        label: "an ambient enum",
        source: `${IMPORT}\ndeclare enum E { A = 1 }\nexport const a = 1;`,
      },
      {
        label: "an ambient namespace",
        source: `${IMPORT}\ndeclare namespace N { const v: typeof Probe; }\nexport const a = 1;`,
      },
      {
        label: "an ambient module declaration",
        source: `${IMPORT}\ndeclare module "m" { const v: typeof Probe; }\nexport const a = 1;`,
      },
      // The runtime TypeScript nodes.
      {
        label: "a real class heritage clause",
        source: `${IMPORT}\nexport class C extends Probe {}`,
      },
      {
        label: "an implements clause",
        source: `${IMPORT}\nexport class C implements Probe { m() { return 1; } }`,
      },
      {
        label: "an interface heritage clause",
        source: `${IMPORT}\nexport interface I extends Probe {}`,
      },
      { label: "an enum initialiser", source: `${IMPORT}\nexport enum E { A = Probe.v }` },
      {
        label: "a namespace body",
        source: `${IMPORT}\nexport namespace N { export const v = Probe; }`,
      },
      { label: "an `as` expression", source: `${IMPORT}\nexport const a = Probe as unknown;` },
      {
        label: "a `satisfies` expression",
        source: `${IMPORT}\nexport const a = Probe satisfies unknown;`,
      },
      { label: "a non-null assertion", source: `${IMPORT}\nexport const a = Probe!;` },
      {
        label: "a parameter property initialiser",
        source: `${IMPORT}\nexport class C { constructor(private p = Probe) {} }`,
      },
      {
        label: "an import-equals alias",
        source: `${IMPORT}\nimport Alias = Probe;\nexport const a = Alias;`,
      },
      {
        label: "an abstract method return type",
        source: `${IMPORT}\nexport abstract class C { abstract m(): Probe; }`,
      },
      {
        label: "an overload signature",
        source:
          `${IMPORT}\nexport function f(p: Probe): void;\nexport function f(p: unknown) { void p; }`,
      },
      { label: "an index signature", source: `${IMPORT}\nexport type A = { [k: string]: Probe };` },
      {
        label: "a mapped type",
        source: `${IMPORT}\nexport type A<T> = { [K in keyof T]: Probe };`,
      },
      {
        label: "a conditional type",
        source: `${IMPORT}\nexport type A<T> = T extends Probe ? 1 : 0;`,
      },
    ];

    for (const { label, source } of TS_FIXTURES) {
      it(`agrees with the artifact about ${label}`, async () => {
        const kept = await esbuildKeepsProbe(source);
        const { flat, scoped } = await walkerReadsProbe(source);

        assertEquals(flat, kept, "referencedIdentifiers disagreed with the artifact");
        assertEquals(scoped, kept, "freeReferencedIdentifiers disagreed with the artifact");
      });
    }

    // The decorator exception to the `declare` short-circuit. esbuild emits a
    // `__decorateClass` call for a decorated ambient member, so the decorator
    // is a real read even though the member it annotates emits nothing.
    it("agrees with the artifact about a decorator on an ambient member", async () => {
      const source = `${IMPORT}\nexport class C { @Probe declare id: string; }`;
      const { code } = await transform(source, {
        ...COMPILE_OPTIONS,
        loader: "tsx",
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
      });

      // Stated so the fixture cannot silently stop exercising the exception.
      assertStringIncludes(code, "__decorateClass");

      const kept = code.includes(PROBE_MODULE);
      assertEquals(kept, true);
      const { flat, scoped } = await walkerReadsProbe(source);
      assertEquals(flat, kept);
      assertEquals(scoped, kept);
    });
  });

  describe("compiler-emitted shapes against esbuild's own output", () => {
    const HOOK_MODULE = [
      `import { hashOf } from "./lib/uses-crypto.ts";`,
      `function loadUser(id) { return hashOf(id); }`,
      `export async function getServerData(ctx) {`,
      `  return { props: { u: loadUser(ctx.id) } };`,
      `}`,
      `export default function Page() { return null; }`,
    ].join("\n");

    // `compilerNameHelperBindings` recognises esbuild's `keepNames` helper by
    // its `Object.defineProperty(target, "name", ...)` shape rather than by its
    // binding name, because minification renames it. The fixture is the real
    // compiler's minified output, so the shape cannot drift from the compiler
    // without this failing.
    it("recognises the keepNames helper in real minified output", async () => {
      const { code } = await transform(HOOK_MODULE, {
        ...COMPILE_OPTIONS,
        loader: "tsx",
        minify: true,
      });

      // The fixture has to contain the helper, or the test proves nothing.
      assertStringIncludes(code, `"name"`);
      assertStringIncludes(code, "configurable");

      const stripped = await stripServerOnlyExports(code, "page.js");

      assertEquals(stripped.includes("uses-crypto"), false, stripped);
      assertEquals(/\bhashOf\b/.test(stripped), false, stripped);
    });

    // `SOURCE_MAP_SUFFIX` approximates the sourcemap comment esbuild writes.
    // The pass rewrites the module, so a stale map has to go with it.
    it("drops the sourcemap comment esbuild actually writes", async () => {
      const { code } = await transform(HOOK_MODULE, {
        ...COMPILE_OPTIONS,
        loader: "tsx",
        sourcemap: "inline",
      });

      assertStringIncludes(code, "sourceMappingURL=");

      const stripped = await stripServerOnlyExports(code, "page.js");

      assertEquals(stripped.includes("sourceMappingURL="), false);
    });
  });

  describe("the defect, measured through the real browser pipeline", () => {
    /** The module-scope names still present in the browser artifact. */
    async function artifact(source: string, projectId: string): Promise<string> {
      const result = await runPipeline(source, "/project/pages/test.tsx", "/project", {
        projectId,
        dev: true,
        ssr: false,
      });
      return result.code;
    }

    // Defect 5. The hook owns the import, so the pass may delete it; the JSX
    // element is the only surviving read, and the ASCII-only test could not see
    // it. The artifact still called the binding, so the page died on load.
    it("keeps a non-ASCII component import the artifact still calls", async () => {
      const source = [
        `import { Caf\u00E9 } from "./ui/cafe.tsx";`,
        `export async function getServerData() { return { props: { n: Caf\u00E9.name } }; }`,
        `export default function Page() { return <Caf\u00E9 />; }`,
      ].join("\n");

      const code = await artifact(source, "predicate-jsx-non-ascii-import");

      assertStringIncludes(code, "./ui/cafe.js");
    });

    it("keeps a non-ASCII component declaration the artifact still calls", async () => {
      const source = [
        `import { render } from "./lib/server-render.ts";`,
        `const Caf\u00E9 = () => null;`,
        `export async function getServerData() { return { props: { h: render(Caf\u00E9) } }; }`,
        `export default function Page() { return <Caf\u00E9 />; }`,
      ].join("\n");

      const code = await artifact(source, "predicate-jsx-non-ascii-declaration");

      // esbuild escapes a non-ASCII identifier in its output, so matching the
      // authored spelling would never hit. The defect deleted the declaration
      // and left the factory call, so both halves are asserted.
      assertStringIncludes(code, "const Caf");
      assertStringIncludes(code, "jsx(Caf");
    });

    // The sibling. A classic-pragma module whose factory root is not ASCII
    // lost the import the emitted `Ħ.créate(...)` call needs.
    it("keeps the factory import a non-ASCII classic pragma names", async () => {
      const source = [
        `/** @jsxRuntime classic @jsx \u0126.cr\u00E9ate @jsxFrag \u0126.Fr\u00E1gment */`,
        `import { \u0126 } from "./ui/factory.ts";`,
        `import { load } from "./lib/server-load.ts";`,
        `export async function getServerData() { return { props: { h: load(\u0126) } }; }`,
        `export default function Page() { return <div />; }`,
      ].join("\n");

      const code = await artifact(source, "predicate-pragma-non-ascii-factory");

      assertStringIncludes(code, "./ui/factory.js");
    });
  });

  describe("the shared identifier test against the runtime's own grammar", () => {
    /**
     * Whether the runtime parses `name` as one identifier.
     *
     * A function declaration is the question, not a `var` statement: a `var`
     * name can be followed by `,`, `=`, `;` or a line terminator and still
     * parse, so those characters would look like valid identifier parts. Only
     * a single BindingIdentifier fits between `function` and `(`.
     */
    function runtimeAcceptsIdentifier(name: string): boolean {
      try {
        new Function(`function ${name}() {}`);
        return true;
      } catch {
        return false;
      }
    }

    // `isEcmaScriptIdentifier` claims to implement the ECMAScript identifier
    // grammar. The runtime evaluating this test implements the same grammar and
    // will say so, which is a second oracle for the same predicate and needs no
    // corpus of expectations at all.
    it("agrees with the runtime over every code point up to U+2FFFF", () => {
      const disagreements: string[] = [];
      for (let cp = 0; cp <= 0x2FFFF; cp++) {
        if (cp >= 0xD800 && cp <= 0xDFFF) continue;
        const ch = String.fromCodePoint(cp);
        if (isEcmaScriptIdentifier(ch) !== runtimeAcceptsIdentifier(ch)) {
          disagreements.push(`U+${cp.toString(16).toUpperCase()} as a start`);
        }
        const inside = `A${ch}_`;
        if (isEcmaScriptIdentifier(inside) !== runtimeAcceptsIdentifier(inside)) {
          disagreements.push(`U+${cp.toString(16).toUpperCase()} as a continuation`);
        }
      }

      assertEquals(disagreements.slice(0, 20), []);
    });

    // Pinned separately from the sweep because the sweep would still pass if
    // the answer were reached a different way. Both joiners are valid in an
    // ID_Continue position and in no other, and the strip has to agree.
    it("accepts both joiners inside an identifier and neither at the start", () => {
      assertEquals(isEcmaScriptIdentifier("A\u200Db"), true);
      assertEquals(isEcmaScriptIdentifier("A\u200Cb"), true);
      assertEquals(isEcmaScriptIdentifier("\u200Db"), false);
      assertEquals(isEcmaScriptIdentifier("\u200Cb"), false);
      assertEquals(runtimeAcceptsIdentifier("A\u200Db"), true);
      assertEquals(runtimeAcceptsIdentifier("\u200Db"), false);
    });
  });
});
