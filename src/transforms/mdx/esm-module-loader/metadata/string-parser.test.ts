import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cleanModuleCode, extractBalancedBlock, parseJsonish } from "./string-parser.ts";

describe("transforms/mdx/esm-module-loader/metadata/string-parser", () => {
  describe("extractBalancedBlock", () => {
    it("extracts a simple braces block", () => {
      const source = "const x = { a: 1 };";
      const result = extractBalancedBlock(source, 10, "{");
      assertEquals(result, "{ a: 1 }");
    });

    it("handles nested braces", () => {
      const source = "const x = { a: { b: 1 } };";
      const result = extractBalancedBlock(source, 10, "{");
      assertEquals(result, "{ a: { b: 1 } }");
    });

    it("extracts brackets", () => {
      const source = "const x = [1, [2, 3]];";
      const result = extractBalancedBlock(source, 10, "[");
      assertEquals(result, "[1, [2, 3]]");
    });

    it("extracts parentheses", () => {
      const source = "foo(bar(baz))";
      const result = extractBalancedBlock(source, 3, "(");
      assertEquals(result, "(bar(baz))");
    });

    it("returns empty string for unbalanced block", () => {
      const source = "{ a: 1";
      const result = extractBalancedBlock(source, 0, "{");
      assertEquals(result, "");
    });

    it("handles strings with braces inside quotes", () => {
      const source = `{ key: "value with { brace }" }`;
      const result = extractBalancedBlock(source, 0, "{");
      assertEquals(result, `{ key: "value with { brace }" }`);
    });

    it("handles escaped quotes inside strings", () => {
      const source = `{ key: "val\\"ue" }`;
      const result = extractBalancedBlock(source, 0, "{");
      assertEquals(result, `{ key: "val\\"ue" }`);
    });

    it("handles single-quoted strings", () => {
      const source = `{ key: 'value with { brace }' }`;
      const result = extractBalancedBlock(source, 0, "{");
      assertEquals(result, `{ key: 'value with { brace }' }`);
    });

    it("explicit close character", () => {
      const source = "const x = { a: 1 };";
      const result = extractBalancedBlock(source, 10, "{", "}");
      assertEquals(result, "{ a: 1 }");
    });

    it("returns empty for empty source", () => {
      assertEquals(extractBalancedBlock("", 0, "{"), "");
    });
  });

  describe("cleanModuleCode", () => {
    it("removes import statements", () => {
      const code = `import { foo } from 'bar';\nconst x = foo();`;
      const result = cleanModuleCode(code);
      assertEquals(result.includes("import"), false);
      assertEquals(result.includes("const x = foo()"), true);
    });

    it("removes export { } blocks", () => {
      const code = `const x = 1;\nexport { x };`;
      const result = cleanModuleCode(code);
      assertEquals(result.includes("export"), false);
    });

    it("converts export default to plain", () => {
      const code = `export default function foo() {}`;
      const result = cleanModuleCode(code);
      assertEquals(result.includes("export default"), false);
      assertEquals(result.includes("function foo()"), true);
    });

    it("converts export const to const", () => {
      const code = `export const x = 1;`;
      const result = cleanModuleCode(code);
      assertEquals(result.trim(), "const x = 1;");
    });

    it("converts export function to function", () => {
      const code = `export function foo() {}`;
      const result = cleanModuleCode(code);
      assertEquals(result.trim(), "function foo() {}");
    });

    it("handles empty string", () => {
      assertEquals(cleanModuleCode(""), "");
    });
  });

  describe("parseJsonish", () => {
    it("parses standard JSON", () => {
      assertEquals(parseJsonish('{"a": 1}'), { a: 1 });
    });

    it("converts single quotes to double quotes", () => {
      assertEquals(parseJsonish("{'a': 1}"), { a: 1 });
    });

    it("adds quotes to unquoted keys", () => {
      assertEquals(parseJsonish("{a: 1}"), { a: 1 });
    });

    it("handles nested objects", () => {
      const result = parseJsonish("{a: {b: 1}}");
      assertEquals(result, { a: { b: 1 } });
    });

    it("returns original string for unparseable input", () => {
      assertEquals(parseJsonish("not json at all"), "not json at all");
    });

    it("handles arrays", () => {
      assertEquals(parseJsonish("[1, 2, 3]"), [1, 2, 3]);
    });

    it("handles empty object", () => {
      assertEquals(parseJsonish("{}"), {});
    });

    it("handles string value", () => {
      assertEquals(parseJsonish('"hello"'), "hello");
    });

    it("handles number value", () => {
      assertEquals(parseJsonish("42"), 42);
    });

    it("handles boolean value", () => {
      assertEquals(parseJsonish("true"), true);
    });

    it("handles null", () => {
      assertEquals(parseJsonish("null"), null);
    });
  });
});
