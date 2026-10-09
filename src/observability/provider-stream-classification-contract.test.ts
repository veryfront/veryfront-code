import { parse } from "npm:@babel/parser@7.29.2";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const PRODUCER_FILES = [
  "extensions/ext-llm-openai/src/openai-chat-stream.ts",
  "extensions/ext-llm-openai/src/openai-responses-stream.ts",
  "extensions/ext-llm-openai/src/openai-sse-buffer.ts",
  "extensions/ext-llm-openai/src/openai-tool-input.ts",
  "extensions/ext-llm-openai/src/openai-stream-metadata.ts",
  "extensions/ext-llm-openai/src/openai-web-search.ts",
  "src/provider/runtime-loader/provider-sse.ts",
];
const ROOT = new URL("../../", import.meta.url);

// Resolve only finite compile-time issue strings: literals, numeric constants,
// conditional branches and helper parameters supplied by finite caller values.
// Never evaluate source code or use provider-controlled values as classifications.
function producerIssues(texts: Map<string, string>): string[] {
  type N = { type: string; [key: string]: unknown };
  type Scope = { name?: string; params: N[]; parent?: Scope };
  type V = string | number;
  const isN = (x: unknown): x is N =>
    typeof x === "object" && x !== null && typeof (x as N).type === "string";
  const scopes = new Map<N, Scope>();
  const constants = new Map<string, N>();
  const calls: N[] = [];
  const source = new Map<N, string>();
  const parents = new Map<N, N>();
  const callName = (n: N): string | undefined =>
    isN(n.callee) && n.callee.type === "Identifier" ? n.callee.name as string : undefined;
  function visit(n: N, scope: Scope, file: string) {
    if (
      n.type === "FunctionDeclaration" || n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression"
    ) {
      scope = {
        name: isN(n.id) ? n.id.name as string : undefined,
        params: n.params as N[],
        parent: scope,
      };
    }
    scopes.set(n, scope);
    source.set(n, file);
    if (n.type === "VariableDeclarator" && isN(n.id) && n.id.type === "Identifier" && isN(n.init)) {
      constants.set(n.id.name as string, n.init);
    }
    if (n.type === "CallExpression") calls.push(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "tokens" || k === "comments") continue;
      if (isN(v)) {
        parents.set(v, n);
        visit(v, scope, file);
      } else if (Array.isArray(v)) {
        for (const x of v) {
          if (isN(x)) {
            parents.set(x, n);
            visit(x, scope, file);
          }
        }
      }
    }
  }
  for (const [file, text] of texts) {
    visit(parse(text, { sourceType: "module", plugins: ["typescript"] }) as unknown as N, {
      params: [],
    }, file);
  }

  function evalN(n: N, seen = new Set<N>()): V[] | undefined {
    if (seen.has(n)) return;
    seen = new Set(seen).add(n);
    if (n.type === "StringLiteral" || n.type === "NumericLiteral") return [n.value as V];
    if (
      n.type === "TSAsExpression" || n.type === "TSNonNullExpression" ||
      n.type === "ParenthesizedExpression"
    ) return evalN(n.expression as N, seen);
    if (n.type === "ConditionalExpression") {
      const a = evalN(n.consequent as N, seen), b = evalN(n.alternate as N, seen);
      return a && b ? [...a, ...b] : undefined;
    }
    if (n.type === "Identifier") {
      const name = n.name as string;
      for (let scope = scopes.get(n); scope; scope = scope.parent) {
        const i = scope.params.findIndex((p) => p.type === "Identifier" && p.name === name);
        if (i >= 0) {
          if (!scope.name) return;
          const values = calls.filter((c) => callName(c) === scope.name).flatMap((c) => {
            const a = (c.arguments as unknown[])[i];
            return isN(a) ? evalN(a, seen) ?? [] : [];
          });
          return values.length ? values : undefined;
        }
      }
      const c = constants.get(name);
      return c ? evalN(c, seen) : undefined;
    }
    if (n.type === "BinaryExpression") {
      const a = evalN(n.left as N, seen), b = evalN(n.right as N, seen);
      if (!a || !b) return;
      return a.flatMap((x) =>
        b.map((y) =>
          n.operator === "*"
            ? Number(x) * Number(y)
            : n.operator === "+"
            ? (typeof x === "string" || typeof y === "string"
              ? String(x) + String(y)
              : Number(x) + Number(y))
            : n.operator === "-"
            ? Number(x) - Number(y)
            : NaN
        )
      );
    }
    if (n.type === "TemplateLiteral") {
      const quasis = n.quasis as N[], expr = n.expressions as N[];
      let rows = [""];
      for (let i = 0; i < quasis.length; i++) {
        const text = (quasis[i]!.value as { cooked: string }).cooked;
        rows = rows.map((x) => x + text);
        if (i < expr.length) {
          const v = evalN(expr[i]!, seen);
          if (!v) return;
          rows = rows.flatMap((x) => v.map((y) => x + y));
        }
      }
      return rows;
    }
  }

  function dynamicShape(n: N): string {
    if (n.type === "Identifier") return n.name as string;
    if (n.type === "TemplateLiteral") {
      return (n.quasis as N[]).map((q, i) =>
        (q.value as { cooked: string }).cooked +
        ((n.expressions as N[])[i] ? "${" + dynamicShape((n.expressions as N[])[i]!) + "}" : "")
      ).join("");
    }
    return n.type;
  }
  const issues = new Set<string>();
  for (const c of calls) {
    const name = callName(c);
    if (!["invalidOpenAIStream", "invalidOpenAIResponsesStream", "invalid"].includes(name ?? "")) {
      continue;
    }
    const issue = (c.arguments as N[])[name === "invalid" ? 0 : 1];
    assert(issue, "Missing parser issue argument in " + source.get(c));
    const values = evalN(issue);
    if (values) {
      for (const value of values) {
        assert(typeof value === "string", "Non-string classification");
        issues.add(value);
      }
      continue;
    }
    const shape = dynamicShape(issue);
    // Only these audited forwarding factories and provider-controlled shapes may
    // remain unresolved. A new expression/helper must be reviewed, not skipped.
    let enclosing = parents.get(c);
    while (enclosing && enclosing.type !== "ArrowFunctionExpression") {
      enclosing = parents.get(enclosing);
    }
    const factory = enclosing && parents.get(enclosing);
    const forwarded = shape === "issue" && factory?.type === "CallExpression" &&
      [
        "appendOpenAISseChunk",
        "finishOpenAISseDecoding",
        "parseOpenAISseBuffer",
        "normalizeOpenAIWebSearchCall",
      ].includes(callName(factory) ?? "");
    const citation = shape === "${issue}: ${detail}" && factory?.type === "CallExpression" &&
      callName(factory) === "validateOpenAIUrlCitation";
    const eventType = shape === "event type ${type} was unsupported" &&
      name === "invalidOpenAIResponsesStream";
    assert(
      forwarded || citation || eventType,
      "Unaudited issue expression in " + source.get(c) + ": " + shape,
    );
  }
  return [...issues].sort();
}
function retainedIssues(text: string): string[] {
  const ast = parse(text, { sourceType: "module", plugins: ["typescript"] });
  for (const statement of ast.program.body) {
    if (statement.type !== "VariableDeclaration") continue;
    const declaration = statement.declarations.find((d) =>
      d.id.type === "Identifier" && d.id.name === "LOGGABLE_OPENAI_STREAM_ISSUES"
    );
    if (!declaration) continue;
    assert(declaration.init?.type === "NewExpression");
    const values = declaration.init.arguments[0];
    assert(values?.type === "ArrayExpression");
    return values.elements.map((value) => {
      assert(value?.type === "StringLiteral");
      return value.value;
    }).sort();
  }
  throw new Error("Fixed classification allowlist was not found");
}
async function readContract() {
  const producers = new Map<string, string>();
  for (const file of PRODUCER_FILES) {
    producers.set(file, await Deno.readTextFile(new URL(file, ROOT)));
  }
  const retained = retainedIssues(
    await Deno.readTextFile(new URL("src/observability/telemetry-error.ts", ROOT)),
  );
  return { producers, retained };
}
describe("fixed provider stream classification contract", () => {
  it("keeps the privacy allowlist equal to finite producer classifications", async () => {
    const { producers, retained } = await readContract();
    assertEquals(producerIssues(producers), retained);
  });
  it("detects wording and limit drift without broadening the privacy allowlist", async () => {
    const { producers, retained } = await readContract();
    for (
      const [file, before, after] of [
        [
          "extensions/ext-llm-openai/src/openai-chat-stream.ts",
          "tool call was incomplete",
          "tool call became incomplete",
        ],
        ["extensions/ext-llm-openai/src/openai-chat-stream.ts", "1_024", "1_025"],
        [
          "extensions/ext-llm-openai/src/openai-responses-stream.ts",
          "added message",
          "added assistant message",
        ],
      ] as const
    ) {
      const changed = new Map(producers);
      const original = changed.get(file)!;
      assert(original.includes(before));
      changed.set(file, original.replaceAll(before, after));
      assertThrows(() => assertEquals(producerIssues(changed), retained));
    }
  });
  it("fails closed on a new unresolved issue expression", async () => {
    const { producers } = await readContract();
    const file = "extensions/ext-llm-openai/src/openai-chat-stream.ts";
    const changed = new Map(producers);
    changed.set(
      file,
      changed.get(file)!.replace('"tool call was incomplete"', "unreviewedProviderText"),
    );
    assertThrows(() => producerIssues(changed), Error, "Unaudited issue expression");
  });
});
