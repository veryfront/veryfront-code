import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parse } from "npm:@babel/parser@7.29.2";
import { hasUseClientDirective } from "#veryfront/rendering/rsc/page-island.ts";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";

// The examples are TS/TSX source, so directive placement can only be judged on
// statements, not raw lines: comments never end a statement, a directive may
// carry one (`'use client'; // Client Component`), and one line may hold
// several statements (`import './setup'; 'use client';`). Parse the snippets
// as TSX instead of approximating JavaScript lexical grammar: comment markers
// inside regex literals, templates, and strings must remain ordinary syntax.

interface ParsedStatementNode {
  readonly type: string;
  readonly start?: number | null;
  readonly end?: number | null;
  readonly value?: ParsedStatementNode | string;
  readonly expression?: ParsedStatementNode;
  readonly callee?: ParsedStatementNode;
  readonly object?: ParsedStatementNode;
  readonly left?: ParsedStatementNode;
  readonly test?: ParsedStatementNode;
  readonly tag?: ParsedStatementNode;
  readonly expressions?: readonly ParsedStatementNode[];
  readonly extra?: { readonly parenthesized?: unknown };
}

// The statements of a file block, comments stripped and semicolons resolved
// first: a trailing comment cannot disguise a directive, a commented-out
// directive is not mistaken for a real one, and a directive sharing a line
// with an earlier statement is still seen in its true position.
function parsedStatementsOf(block: string): ParsedStatementNode[] {
  const program = parse(block, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  }).program;
  return ([...program.directives, ...program.body] as ParsedStatementNode[])
    .toSorted((left, right) => (left.start ?? 0) - (right.start ?? 0));
}

function statementsOf(block: string): string[] {
  return parsedStatementsOf(block).map((statement) =>
    block.slice(statement.start ?? 0, statement.end ?? 0).trim()
  );
}

function isUseClientLiteral(node: ParsedStatementNode | string | undefined): boolean {
  return typeof node === "object" &&
    (node?.type === "StringLiteral" || node?.type === "DirectiveLiteral") &&
    node.value === "use client";
}

function isUseClientStatement(statement: ParsedStatementNode): boolean {
  if (statement.type === "Directive") return isUseClientLiteral(statement.value);
  return statement.type === "ExpressionStatement" &&
    isUseClientLiteral(statement.expression) &&
    statement.expression?.extra?.parenthesized !== true;
}

function startsWithUseClientExpression(statement: ParsedStatementNode): boolean {
  if (statement.type === "Directive") return isUseClientLiteral(statement.value);
  if (statement.type !== "ExpressionStatement") return false;

  let expression = statement.expression;
  while (expression) {
    if (isUseClientLiteral(expression)) return true;
    if (
      expression.type === "CallExpression" || expression.type === "OptionalCallExpression"
    ) {
      expression = expression.callee;
      continue;
    }
    if (
      expression.type === "MemberExpression" || expression.type === "OptionalMemberExpression"
    ) {
      expression = expression.object;
      continue;
    }
    if (
      expression.type === "ParenthesizedExpression" || expression.type === "TSAsExpression" ||
      expression.type === "TSTypeAssertion" || expression.type === "TSNonNullExpression" ||
      expression.type === "TSSatisfiesExpression" || expression.type === "TSInstantiationExpression"
    ) {
      expression = expression.expression;
      continue;
    }
    if (expression.type === "BinaryExpression" || expression.type === "LogicalExpression") {
      expression = expression.left;
      continue;
    }
    if (expression.type === "ConditionalExpression") {
      expression = expression.test;
      continue;
    }
    if (expression.type === "SequenceExpression") {
      expression = expression.expressions?.[0];
      continue;
    }
    if (expression.type === "TaggedTemplateExpression") {
      expression = expression.tag;
      continue;
    }
    return false;
  }
  return false;
}

// Statement index of every 'use client' expression statement in a file block.
function useClientIndexes(block: string): number[] {
  return parsedStatementsOf(block)
    .map((statement, index) => (isUseClientStatement(statement) ? index : -1))
    .filter((index) => index !== -1);
}

const stringLiteralStatement = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*");?$/;

function invalidUseClientIndexes(block: string): number[] {
  const statements = statementsOf(block);
  const indexes = useClientIndexes(block);
  const directiveLikeIndexes = parsedStatementsOf(block)
    .map((statement, index) => (startsWithUseClientExpression(statement) ? index : -1))
    .filter((index) => index !== -1);
  // Use the runtime classifier as the source of truth for whether a leading
  // string is actually a directive. In particular, a semicolonless string
  // followed by an ASI continuation token or a wrapped string is one
  // expression, not a directive.
  if (directiveLikeIndexes.length > 0 && !hasUseClientDirective(block)) {
    return directiveLikeIndexes;
  }

  return indexes.filter((index) =>
    statements.slice(0, index).some((statement) => !stringLiteralStatement.test(statement))
  );
}

describe("ERROR_SOLUTIONS", () => {
  it("should be a non-empty record", () => {
    assertEquals(typeof ERROR_SOLUTIONS, "object");
    assert(Object.keys(ERROR_SOLUTIONS).length > 0);
  });

  it("should contain all expected error keys", () => {
    const expectedKeys = [
      "missing-config",
      "invalid-config",
      "invalid-route",
      "client-boundary",
      "import-not-found",
      "port-in-use",
      "build-failed",
      "missing-deps",
    ];

    for (const key of expectedKeys) {
      assert(key in ERROR_SOLUTIONS, `Missing key: ${key}`);
    }
  });

  it("should have message for every error solution", () => {
    for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
      assert(
        typeof solution.message === "string" && solution.message.length > 0,
        `${key} should have a non-empty message`,
      );
    }
  });

  it("should have non-empty steps for every error solution", () => {
    for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
      const steps = solution.steps;
      assert(
        Array.isArray(steps) && steps.length > 0,
        `${key} must ship remediation steps`,
      );

      for (const step of steps) {
        assert(typeof step === "string" && step.length > 0, `${key} has empty step`);
      }
    }
  });

  describe("missing-config", () => {
    it("should have steps and an example", () => {
      const sol = ERROR_SOLUTIONS["missing-config"];
      assertExists(sol);
      assertExists(sol.steps);
      assert(sol.steps.length >= 2);
      assertExists(sol.example);
      assert(sol.example.includes("export default"));
    });

    it("should list supported files without claiming init creates one", () => {
      const sol = ERROR_SOLUTIONS["missing-config"];
      assertExists(sol);
      const guidance = JSON.stringify(sol).toLowerCase();

      assert(guidance.includes("veryfront.config.js"));
      assert(guidance.includes("veryfront.config.ts"));
      assert(guidance.includes("veryfront.config.mjs"));
      assertEquals(guidance.includes("veryfront init"), false);
      assertEquals(guidance.includes("vf init"), false);
    });
  });

  describe("invalid-config", () => {
    it("should not describe legal trailing commas as invalid", () => {
      const sol = ERROR_SOLUTIONS["invalid-config"];
      assertExists(sol);
      const guidance = JSON.stringify(sol).toLowerCase();

      assertEquals(guidance.includes("remove any trailing comma"), false);
      assert(guidance.includes("trailing commas are valid"));
    });

    it("should name the configuration file family it actually loads", () => {
      const sol = ERROR_SOLUTIONS["invalid-config"];
      assertExists(sol);

      assert(
        sol.message.toLowerCase().includes("veryfront.config"),
        "invalid-config must name the veryfront.config file family",
      );
      assertEquals(
        /vf\.config|\.config\.json/i.test(JSON.stringify(sol)),
        false,
        "invalid-config must not name a config file the loader never reads",
      );
    });
  });

  describe("port-in-use", () => {
    it("should mention port in message", () => {
      const sol = ERROR_SOLUTIONS["port-in-use"];
      assertExists(sol);
      assert(sol.message.toLowerCase().includes("port"));
    });

    it("should have an example with --port flag", () => {
      const sol = ERROR_SOLUTIONS["port-in-use"];
      assertExists(sol);
      assertExists(sol.example);
      assert(sol.example.includes("--port"));
    });
  });

  describe("client-boundary", () => {
    it("should reference docs URL", () => {
      const sol = ERROR_SOLUTIONS["client-boundary"];
      assertExists(sol);
      assertExists(sol.docs);
      assertEquals(
        sol.docs,
        "https://veryfront.com/docs/code/guides/errors#client-boundary-violation",
      );
    });

    it("should demonstrate both halves of the fix in its example", () => {
      const sol = ERROR_SOLUTIONS["client-boundary"];
      assertExists(sol);
      assertExists(sol.example);

      assert(sol.example.includes("use client"), "example shows the client directive");
      assert(sol.example.includes("await db.query"), "example shows the server-side data fetch");
      const queryAssignment =
        /const\s+(?:\{\s*([A-Za-z_$][\w$]*)\s*\}|([A-Za-z_$][\w$]*))\s*=\s*await db\.query/.exec(
          sol.example,
        );
      assertExists(queryAssignment, "example assigns the server-side query result");
      const fetchedValue = queryAssignment[1] ?? queryAssignment[2];
      assertExists(fetchedValue);
      assert(
        new RegExp(`<[A-Z][\\w$]*\\s+[\\w$]+=\\{${fetchedValue}\\}\\s*/>`).test(sol.example),
        "example shows data passed across the boundary",
      );
    });
  });

  describe("example structure", () => {
    // AGENTS.md requires code examples to be complete, copyable and safe to
    // paste. These assert the shape of the copy rather than its wording, which
    // is what the entry-shape tests could not catch.
    it("places every 'use client' directive at the top of its own file block", () => {
      for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
        const example = solution.example;
        if (!example || !/['"]use client['"]/.test(example)) continue;

        // Split only on the complete file-header form, `// ❌ Wrong: path` or
        // `// ✅ Correct: path`. Anything looser lets an ordinary annotation
        // open a block, so a misplaced directive lands at index 0 of it and the
        // guard passes invalid code.
        for (const block of example.split(/\n(?=\/\/ (?:❌ Wrong|✅ Correct): )/)) {
          const statements = statementsOf(block);

          // Another string-literal directive may precede use client. Reject
          // only occurrences after a non-directive statement, including a
          // second inert occurrence later in the file.
          for (const index of invalidUseClientIndexes(block)) {
            assert(
              false,
              `${key}: 'use client' must stay in the directive prologue, but one follows ` +
                `${statements[index - 1]}`,
            );
          }
        }
      }
    });

    describe("directive placement guard", () => {
      // The guard above went through three rounds of regex patching, each
      // recognising exactly the misplacement in front of it and admitting the
      // next spelling. These cases pin the parse itself, so the catalog test
      // cannot silently stop enforcing placement.
      it("sees a misplaced directive that carries a trailing comment", () => {
        const block = [
          "// ✅ Correct: app/x.tsx (Client Component)",
          "import { a } from './a';",
          "'use client'; // Client Component",
        ].join("\n");

        assertEquals(
          useClientIndexes(block),
          [1],
          "a trailing comment must not hide a misplaced directive",
        );
      });

      it("keeps a directive first when only comments and blank lines precede it", () => {
        const block = [
          "/* app/x.tsx",
          "   renders on the client */",
          "",
          "// header",
          "'use client';",
          "import { a } from './a';",
        ].join("\n");

        assertEquals(
          useClientIndexes(block),
          [0],
          "a comment prologue does not displace the directive",
        );
      });

      it("flags a directive that follows a statement", () => {
        const block = [
          "import { a } from './a';",
          '"use client"',
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [1],
          "a directive after an import is inert and must be reported",
        );
      });

      it("sees a directive that shares a line with an earlier statement", () => {
        const block = [
          "// ✅ Correct: app/x.tsx (Client Component)",
          "import './setup'; 'use client';",
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [1],
          "statements split at semicolons, not only at newlines",
        );
      });

      it("keeps use client inside a multi-directive prologue", () => {
        const block = [
          "'use strict'; 'use client';",
          "import { a } from './a';",
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [],
          "another string-literal directive may precede use client",
        );
      });

      it("rejects a semicolonless directive continued by ASI", () => {
        const block = [
          "'use client'",
          "(function () {})()",
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [0],
          "a continued string expression is not a directive statement",
        );
      });

      it("rejects semicolonless directives continued as expressions", () => {
        for (
          const continuation of [
            "+enabled",
            "&& enabled",
            "? enabled : disabled",
            ", enabled",
            "`tag`",
          ]
        ) {
          const block = ["'use client'", continuation].join("\n");

          assertEquals(
            invalidUseClientIndexes(block),
            [0],
            `${continuation} continues the string instead of starting a directive statement`,
          );
        }
      });

      it("rejects a directive-like string wrapped in an expression", () => {
        const block = [
          "// ✅ Correct: app/x.tsx (Client Component)",
          "('use client');",
          "export default function Example() { return null; }",
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [0],
          "a wrapped string is not a runtime directive and must be reported",
        );
      });

      it("does not split a statement at a semicolon inside a string", () => {
        const block = [
          "'use client';",
          "const sql = 'SELECT 1; SELECT 2';",
        ].join("\n");

        assertEquals(
          useClientIndexes(block),
          [0],
          "a quoted semicolon is data, not a statement boundary",
        );
      });

      it("does not mistake a commented-out directive for a real one", () => {
        const block = [
          "// 'use client';",
          '/* "use client" */',
          "import { a } from './a';",
        ].join("\n");

        assertEquals(
          useClientIndexes(block),
          [],
          "a directive inside a comment is not a directive",
        );
      });

      it("does not mistake comment markers inside a regex literal for comments", () => {
        const block = [
          "const marker = /[/*]/;",
          "'use client';",
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [1],
          "a regex literal must not hide a later misplaced directive",
        );
      });

      it("does not treat directive spelling inside another statement as a directive", () => {
        const block = [
          `throw new Error("'use client' is required");`,
          "export default function Example() { return null; }",
        ].join("\n");

        assertEquals(
          invalidUseClientIndexes(block),
          [],
          "an error message is not a directive expression",
        );
      });
    });

    it("labels the corrected half of a wrong/right example", () => {
      for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
        const example = solution.example;
        if (!example?.includes("❌")) continue;

        assert(
          example.includes("✅"),
          `${key}: an example that marks a wrong form must mark the corrected one too, ` +
            `or the whole block reads as broken`,
        );
      }
    });

    it("consumes the data it threads across the client boundary", () => {
      const example = ERROR_SOLUTIONS["client-boundary"]?.example;
      assertExists(example);

      assert(
        /users\.map\(/.test(example),
        "the client component must use the prop the example exists to pass it",
      );
      assert(
        !/key=\{user\.name\}/.test(example),
        "rows are keyed by a unique column, since names are not unique",
      );
      assert(
        !/Wrong:[\s\S]*?export default async function DashboardPage\(\)/.test(
          example.split("// ✅ Correct:", 1)[0]!,
        ),
        "the invalid Client Component should not add an unrelated async component error",
      );
    });
  });

  describe("missing-deps", () => {
    it("should keep recovery guidance package-manager neutral", () => {
      const sol = ERROR_SOLUTIONS["missing-deps"];
      assertExists(sol);

      assertEquals(sol.example, undefined);
      assert(sol.steps?.some((step) => step.includes("project package manager")));
      assertEquals(JSON.stringify(sol).includes("<PACKAGE_SPECIFIER>"), false);
      assertEquals(JSON.stringify(sol).includes("deno add"), false);
    });
  });

  it("should expose immutable solution definitions", () => {
    const missingConfig = ERROR_SOLUTIONS["missing-config"];
    assertExists(missingConfig);
    assertExists(missingConfig.steps);

    assertEquals(Object.isFrozen(ERROR_SOLUTIONS), true);
    assertEquals(Object.isFrozen(missingConfig), true);
    assertEquals(Object.isFrozen(missingConfig.steps), true);
  });
});
