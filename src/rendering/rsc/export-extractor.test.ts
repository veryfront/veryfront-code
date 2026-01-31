import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractExportNames } from "./export-extractor.ts";

describe("rendering/rsc/export-extractor", () => {
  describe("extractExportNames", () => {
    function assertIncludes(names: string[], name: string): void {
      assertEquals(names.includes(name), true);
    }

    it("should extract default export", () => {
      const names = extractExportNames(`export default function App() {}`);
      assertIncludes(names, "default");
    });

    it("should extract named function exports", () => {
      const names = extractExportNames(
        `export function greet() {}\nexport function farewell() {}`,
      );
      assertIncludes(names, "greet");
      assertIncludes(names, "farewell");
    });

    it("should extract named class exports", () => {
      const names = extractExportNames(`export class MyComponent {}`);
      assertIncludes(names, "MyComponent");
    });

    it("should extract const/let/var exports", () => {
      const names = extractExportNames(
        `export const FOO = 1;\nexport let bar = 2;\nexport var baz = 3;`,
      );
      assertIncludes(names, "FOO");
      assertIncludes(names, "bar");
      assertIncludes(names, "baz");
    });

    it("should extract named exports from braces", () => {
      const names = extractExportNames(`const a = 1; const b = 2;\nexport { a, b };`);
      assertIncludes(names, "a");
      assertIncludes(names, "b");
    });

    it("should handle 'as' aliases in export braces", () => {
      const names = extractExportNames(`const foo = 1;\nexport { foo as bar };`);
      assertIncludes(names, "bar");
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
      assertIncludes(names, "default");
      assertIncludes(names, "helper");
      assertIncludes(names, "VALUE");
      assertIncludes(names, "Widget");
    });

    it("should not duplicate names", () => {
      const names = extractExportNames(`export default function App() {}\nexport { App };`);
      const defaultCount = names.filter((n) => n === "default").length;
      assertEquals(defaultCount, 1);
    });
  });
});
