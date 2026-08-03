import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import type {
  ASTNode,
  CodeParser,
  FunctionDirectiveOptions,
  GenerateResult,
  NodePath,
  TraverseVisitor,
} from "#veryfront/extensions/parser/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { inspectBrowserModuleBoundary } from "./browser-module-boundary.ts";

const babelParser = tryResolve<CodeParser>("CodeParser");
if (!babelParser) throw new Error("CodeParser test setup failed");

interface EstreeDirectiveStatement extends ASTNode {
  type: "ExpressionStatement";
  directive: string;
}

interface EstreeFunctionNode extends ASTNode {
  type: "FunctionDeclaration";
  body: ASTNode & { body: EstreeDirectiveStatement[] };
}

function createEstreeParser(options: { semanticCapability: boolean }): CodeParser {
  const functionNode: EstreeFunctionNode = {
    type: "FunctionDeclaration",
    body: {
      type: "BlockStatement",
      body: [{ type: "ExpressionStatement", directive: "use server" }],
    },
  };
  const parser: CodeParser & {
    hasFunctionDirective?: (options: FunctionDirectiveOptions) => Promise<boolean>;
  } = {
    parse: () => Promise.resolve({ type: "Program", body: [functionNode] }),
    traverse: (_ast: ASTNode, visitor: TraverseVisitor) => {
      const callback = visitor.FunctionDeclaration;
      const path: NodePath = {
        node: functionNode,
        parent: undefined,
        replaceWith: () => {},
        remove: () => {},
      };
      if (typeof callback === "function") callback(path);
      else callback?.enter?.(path);
    },
    generate: (): Promise<GenerateResult> => Promise.resolve({ code: "" }),
    injectJsxNodePositions: (source: string) => source,
  };
  if (options.semanticCapability) {
    parser.hasFunctionDirective = ({ directive }) =>
      Promise.resolve(
        functionNode.body.body.some((statement) => statement.directive === directive),
      );
  }
  return parser;
}

describe("server/shared/browser-module-boundary", () => {
  it("detects function-local server directives in supported script variants", async () => {
    const sources = [
      `export async function save() { "use server"; return true; }`,
      `export const save = async function () { 'use server'; return true; };`,
      `export const save = async () => { /* boundary */ "use server"; return true; };`,
      `export const actions = { async save() { "use server"; return true; } };`,
      `export class Actions { async save() { "use server"; return true; } }`,
    ];

    for (const source of sources) {
      assertEquals(await inspectBrowserModuleBoundary(source, "/project/app/actions.tsx"), {
        kind: "function-server",
      });
    }
  });

  it("parses function-local boundaries across standard module extensions", async () => {
    for (
      const extension of [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
      ]
    ) {
      const typeAnnotation = extension.includes("t") ? ": Promise<string>" : "";
      const source = [
        `async function save()${typeAnnotation} {`,
        '  "use server";',
        '  return "private";',
        "}",
      ].join("\n");

      assertEquals(await inspectBrowserModuleBoundary(source, `/project/app/actions${extension}`), {
        kind: "function-server",
      });
    }
  });

  it("ignores directive-like text outside a function directive prologue", async () => {
    const sources = [
      `export function save() { /* "use server" */ return true; }`,
      ["export function save() {", "  const text = `", "'use server';", "`;", "}"].join(
        "\n",
      ),
      `export function save() { const ready = true; "use server"; return ready; }`,
      `if (ready) { "use server"; run(); }`,
      `export const value = { directive: "use server" };`,
    ];

    for (const source of sources) {
      assertEquals(await inspectBrowserModuleBoundary(source, "/project/app/shared.tsx"), null);
    }
  });

  it("distinguishes module boundaries, conflicts, and parse failures", async () => {
    assertEquals(
      await inspectBrowserModuleBoundary(`"use server"; export const value = true;`, "/app/a.ts"),
      { kind: "module-server" },
    );
    assertEquals(
      await inspectBrowserModuleBoundary(
        `"use client"; "use server"; export const value = true;`,
        "/app/a.ts",
      ),
      { kind: "conflicting" },
    );
    assertEquals(
      await inspectBrowserModuleBoundary(`export const broken = ;`, "/app/a.ts"),
      { kind: "parse-error" },
    );
  });

  it("fails closed for a non-Babel parser without directive semantics", async () => {
    register("CodeParser", createEstreeParser({ semanticCapability: false }));
    try {
      assertEquals(
        await inspectBrowserModuleBoundary(
          `export async function save() { "use server"; return "private"; }`,
          "/app/actions.ts",
        ),
        { kind: "parse-error" },
      );
    } finally {
      register("CodeParser", babelParser);
    }
  });

  it("uses provider-owned directive semantics for non-Babel ASTs", async () => {
    register("CodeParser", createEstreeParser({ semanticCapability: true }));
    try {
      assertEquals(
        await inspectBrowserModuleBoundary(
          `export async function save() { "use server"; return "private"; }`,
          "/app/actions.ts",
        ),
        { kind: "function-server" },
      );
    } finally {
      register("CodeParser", babelParser);
    }
  });

  it("accepts bundler-compatible syntax through the browser boundary", async () => {
    const sources = [
      {
        path: "/app/shared.cjs",
        source: "if (module.parent) return; module.exports = true;",
      },
      {
        path: "/app/shared.mjs",
        source: 'import data from "./data.json" assert { type: "json" }; export { data };',
      },
      {
        path: "/app/shared.ts",
        source: "class Store { @logged accessor value = 1; } export { Store };",
      },
    ];

    for (const { path, source } of sources) {
      assertEquals(await inspectBrowserModuleBoundary(source, path), null);
    }
  });
});
