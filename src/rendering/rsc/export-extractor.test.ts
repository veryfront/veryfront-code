import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractExportNames } from "./export-extractor.ts";

describe("rendering/rsc/export-extractor", () => {
  describe("extractExportNames", () => {
    function assertIncludes(names: string[], name: string): void {
      assertEquals(names.includes(name), true);
    }

    it("should extract default export", async () => {
      const names = await extractExportNames(`export default function App() {}`);
      assertIncludes(names, "default");
    });

    it("should extract named function exports", async () => {
      const names = await extractExportNames(
        `export function greet() {}\nexport function farewell() {}`,
      );
      assertIncludes(names, "greet");
      assertIncludes(names, "farewell");
    });

    it("should extract named class exports", async () => {
      const names = await extractExportNames(`export class MyComponent {}`);
      assertIncludes(names, "MyComponent");
    });

    it("should extract const/let/var exports", async () => {
      const names = await extractExportNames(
        `export const FOO = 1;\nexport let bar = 2;\nexport var baz = 3;`,
      );
      assertIncludes(names, "FOO");
      assertIncludes(names, "bar");
      assertIncludes(names, "baz");
    });

    it("should extract named exports from braces", async () => {
      const names = await extractExportNames(`const a = 1; const b = 2;\nexport { a, b };`);
      assertIncludes(names, "a");
      assertIncludes(names, "b");
    });

    it("should handle 'as' aliases in export braces", async () => {
      const names = await extractExportNames(`const foo = 1;\nexport { foo as bar };`);
      assertIncludes(names, "bar");
    });

    it("should return empty array for no exports", async () => {
      const names = await extractExportNames(`const x = 1;`);
      assertEquals(names.length, 0);
    });

    it("should handle mixed exports", async () => {
      const source = `
        export default function App() {}
        export function helper() {}
        export const VALUE = 42;
        export class Widget {}
      `;
      const names = await extractExportNames(source);
      assertIncludes(names, "default");
      assertIncludes(names, "helper");
      assertIncludes(names, "VALUE");
      assertIncludes(names, "Widget");
    });

    it("should not duplicate names", async () => {
      const names = await extractExportNames(`export default function App() {}\nexport { App };`);
      const defaultCount = names.filter((n) => n === "default").length;
      assertEquals(defaultCount, 1);
    });

    it("should extract async functions and all variable declaration exports", async () => {
      const names = await extractExportNames(
        `export async function load() {}\nexport const one = 1, two = 2;`,
      );
      assertIncludes(names, "load");
      assertIncludes(names, "one");
      assertIncludes(names, "two");
    });

    it("should not extract export-looking text from strings or comments", async () => {
      const names = await extractExportNames(`
        const text = "export function fake() {}";
        // export const hidden = 1;
        /* export class Hidden {} */
      `);
      assertEquals(names, []);
    });

    it("should skip type-only exports", async () => {
      const names = await extractExportNames(`
        export type Props = { name: string };
        export interface State { count: number }
        export { type Props as PublicProps };
      `);
      assertEquals(names, []);
    });
  });
});
