import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractExportNames } from "./export-extractor.ts";

describe("rendering/rsc/export-extractor", () => {
  describe("extractExportNames", () => {
    it("should extract default export", () => {
      const names = extractExportNames(`export default function App() {}`);
      assertEquals(names.includes("default"), true);
    });

    it("should extract named function exports", () => {
      const names = extractExportNames(`export function greet() {}\nexport function farewell() {}`);
      assertEquals(names.includes("greet"), true);
      assertEquals(names.includes("farewell"), true);
    });

    it("should extract named class exports", () => {
      const names = extractExportNames(`export class MyComponent {}`);
      assertEquals(names.includes("MyComponent"), true);
    });

    it("should extract const/let/var exports", () => {
      const names = extractExportNames(
        `export const FOO = 1;\nexport let bar = 2;\nexport var baz = 3;`,
      );
      assertEquals(names.includes("FOO"), true);
      assertEquals(names.includes("bar"), true);
      assertEquals(names.includes("baz"), true);
    });

    it("should extract named exports from braces", () => {
      const names = extractExportNames(`const a = 1; const b = 2;\nexport { a, b };`);
      assertEquals(names.includes("a"), true);
      assertEquals(names.includes("b"), true);
    });

    it("should handle 'as' aliases in export braces", () => {
      const names = extractExportNames(`const foo = 1;\nexport { foo as bar };`);
      assertEquals(names.includes("bar"), true);
    });

    it("should return empty array for no exports", () => {
      const names = extractExportNames(`const x = 1;`);
      assertEquals(names.length, 0);
    });

    it("should handle mixed exports", () => {
      const source = `
        export default function App() {}
        export function helper() {}
        export const VALUE = 42;
        export class Widget {}
      `;
      const names = extractExportNames(source);
      assertEquals(names.includes("default"), true);
      assertEquals(names.includes("helper"), true);
      assertEquals(names.includes("VALUE"), true);
      assertEquals(names.includes("Widget"), true);
    });

    it("should not duplicate names", () => {
      const names = extractExportNames(`export default function App() {}\nexport { App };`);
      const defaultCount = names.filter((n) => n === "default").length;
      assertEquals(defaultCount, 1);
    });
  });
});
