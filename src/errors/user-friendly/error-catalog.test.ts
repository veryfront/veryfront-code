import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ERROR_SOLUTIONS } from "./error-catalog.ts";

// The examples are TS/TSX source, so directive placement can only be judged on
// statements, not raw lines: comments never end a statement, a directive may
// carry one (`'use client'; // Client Component`), and one line may hold
// several statements (`import './setup'; 'use client';`). This is a minimal
// scanner, not a parser — it removes `//` and `/* */` comments and breaks at
// code-level semicolons while staying string-aware (so `'https://x'` and a
// quoted `;` survive) and preserving newlines, which is exactly enough to
// recover the statements of the flat catalog examples.
function toStatementSource(source: string): string {
  let out = "";
  let state: "code" | "line-comment" | "block-comment" | "string" = "code";
  let quote = "";

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    const next = source[i + 1];

    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line-comment";
        i++;
      } else if (char === "/" && next === "*") {
        state = "block-comment";
        i++;
      } else if (char === ";") {
        // A code-level semicolon ends a statement just as a newline does, so
        // several statements sharing one line still split. Semicolons inside
        // strings take the branch below and survive.
        out += "\n";
      } else {
        if (char === "'" || char === '"' || char === "`") {
          state = "string";
          quote = char;
        }
        out += char;
      }
    } else if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        out += char;
      }
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        state = "code";
        i++;
      } else if (char === "\n") {
        // Keep the line structure so later statements stay on their own lines.
        out += char;
      }
    } else {
      if (char === "\\") {
        out += char + (next ?? "");
        i++;
        continue;
      }
      // A newline closes an unterminated ' or " string, so a stray quote in
      // JSX prose cannot swallow the rest of the block.
      if (char === quote || (char === "\n" && quote !== "`")) {
        state = "code";
      }
      out += char;
    }
  }

  return out;
}

// Match the directive syntax, not one exact spelling: single or double quotes,
// with or without the trailing semicolon, are all forms Veryfront honours and
// project templates use.
const directive = /^['"]use client['"];?$/;

// The statements of a file block, comments stripped and semicolons resolved
// first: a trailing comment cannot disguise a directive, a commented-out
// directive is not mistaken for a real one, and a directive sharing a line
// with an earlier statement is still seen in its true position.
function statementsOf(block: string): string[] {
  return toStatementSource(block)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// Statement index of every 'use client' expression statement in a file block.
function useClientIndexes(block: string): number[] {
  return statementsOf(block)
    .map((statement, index) => (directive.test(statement) ? index : -1))
    .filter((index) => index !== -1);
}

const stringLiteralStatement = /^(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")$/;

function invalidUseClientIndexes(block: string): number[] {
  const statements = statementsOf(block);
  return useClientIndexes(block).filter((index) =>
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

  it("should have steps arrays when present", () => {
    for (const [key, solution] of Object.entries(ERROR_SOLUTIONS)) {
      const steps = solution.steps;
      if (steps === undefined) continue;

      assert(Array.isArray(steps), `${key} steps should be an array`);
      assert(steps.length > 0, `${key} steps should not be empty`);

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
