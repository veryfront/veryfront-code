import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findAntiSlop, findAntiSlopFindings } from "./audit-anti-slop.ts";
import { ParseFailure } from "./ratchet.ts";

const rulesOf = (source: string, file = "a.ts") =>
  findAntiSlop(source, file).map((finding) => finding.rule);

describe("no-chained-type-assertions", () => {
  it("reports `as unknown as` once, at the outermost link", () => {
    const findings = findAntiSlop(
      `const value = input as unknown as { id: string };`,
      "a.ts",
    );

    assertEquals(findings.length, 1);
    assertEquals(findings[0]?.rule, "no-chained-type-assertions");
    assertEquals(findings[0]?.line, 1);
  });

  it("reports a parenthesized chain", () => {
    assertEquals(rulesOf(`const value = (input as never) as string;`), [
      "no-chained-type-assertions",
    ]);
  });

  it("reports a three-link chain once", () => {
    assertEquals(
      rulesOf(`const value = input as unknown as object as string;`).length,
      1,
    );
  });

  it("allows a single assertion", () => {
    assertEquals(rulesOf(`const value = input as string;`), []);
  });

  it("allows an all-const chain", () => {
    assertEquals(rulesOf(`const value = ([1, 2] as const) as const;`), []);
  });

  it("reports a chain that mixes const with a real assertion", () => {
    assertEquals(
      rulesOf(`const value = [1, 2] as const as readonly unknown[];`),
      ["no-chained-type-assertions"],
    );
  });

  it("reports angle-bracket chains in .ts sources", () => {
    assertEquals(rulesOf(`const value = <string> <unknown> input;`), [
      "no-chained-type-assertions",
    ]);
  });
});

describe("no-unknown-type-aliases", () => {
  it("reports a direct alias to unknown", () => {
    const findings = findAntiSlop(`type Payload = unknown;`, "a.ts");

    assertEquals(findings.length, 1);
    assertEquals(findings[0]?.rule, "no-unknown-type-aliases");
    assertEquals(findings[0]?.detail, "Payload");
  });

  it("reports an exported alias chain that resolves to unknown", () => {
    assertEquals(
      rulesOf(`type Inner = unknown;\nexport type Outer = Inner;`).length,
      2,
    );
  });

  it("allows aliases to concrete types and self-referential cycles", () => {
    assertEquals(rulesOf(`type Payload = { id: string };`), []);
    assertEquals(rulesOf(`type Loop = Loop;`), []);
  });

  it("allows generic aliases and references with type arguments", () => {
    assertEquals(rulesOf(`type Wrap<T> = T;\ntype Value = Wrap<unknown>;`), []);
  });
});

describe("no-object-parameters", () => {
  it("reports a parameter annotated with the broad object type", () => {
    const findings = findAntiSlop(
      `function inspect(value: object): void {}`,
      "a.ts",
    );

    assertEquals(findings.length, 1);
    assertEquals(findings[0]?.rule, "no-object-parameters");
    assertEquals(findings[0]?.detail, "value");
  });

  it("reports object inside a union and on arrow/method/type signatures", () => {
    assertEquals(rulesOf(`const f = (value: object | null) => value;`), [
      "no-object-parameters",
    ]);
    assertEquals(rulesOf(`interface I { handle(value: object): void; }`), [
      "no-object-parameters",
    ]);
    assertEquals(rulesOf(`type Fn = (value: object) => void;`), [
      "no-object-parameters",
    ]);
  });

  it("flags defaulted parameters but not object-array rest parameters", () => {
    // `object[]` is an array type, not the broad `object` keyword.
    assertEquals(rulesOf(`function f(...values: object[]): void {}`), []);
    assertEquals(rulesOf(`function f(value: object = {}): void {}`), [
      "no-object-parameters",
    ]);
  });

  it("allows named types, Record, and unannotated parameters", () => {
    assertEquals(
      rulesOf(
        `function f(a: { id: string }, b: Record<string, unknown>, c) {}`,
      ),
      [],
    );
  });
});

describe("findAntiSlop parsing", () => {
  it("parses JSX in .tsx sources", () => {
    assertEquals(
      rulesOf(
        `export const El = () => <div>{x as unknown as string}</div>;`,
        "a.tsx",
      ),
      ["no-chained-type-assertions"],
    );
  });

  it("fails closed on unparsable sources", () => {
    assertThrows(() => findAntiSlop(`const = ;`, "a.ts"), ParseFailure);
  });

  it("ignores violations spelled inside comments", () => {
    assertEquals(rulesOf(`// const v = x as unknown as string;`), []);
  });
});

describe("findAntiSlopFindings", () => {
  it("groups each finding under its rule for the per-rule baseline", () => {
    assertEquals(
      findAntiSlopFindings(
        `type Payload = unknown;\nfunction f(value: object) {}`,
        "a.ts",
      ),
      [
        {
          file: "a.ts",
          line: 1,
          message: "no-unknown-type-aliases (Payload)",
          group: "no-unknown-type-aliases",
        },
        {
          file: "a.ts",
          line: 2,
          message: "no-object-parameters (value)",
          group: "no-object-parameters",
        },
      ],
    );
  });
});
