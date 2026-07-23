import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ensureFilenameDefaultExport } from "./filename-default-export.ts";

describe("modules/loader-shared/filename-default-export", () => {
  it("adds a filename-matched default export", () => {
    assertEquals(
      ensureFilenameDefaultExport("pages/Page.tsx", "export function Page() {}\n"),
      "export function Page() {}\nexport { Page as default };\n",
    );
  });

  it("ignores default-export text in comments, strings, templates, and regex literals", () => {
    const code = [
      "// export default Commented",
      'const text = "export default StringValue";',
      "const template = \`export default TemplateValue\`;",
      "const pattern = /export default RegexValue/;",
      "export function Page() {}",
    ].join("\n");

    const result = ensureFilenameDefaultExport("Page.tsx", code);
    assertEquals(result.endsWith("export { Page as default };\n"), true);
  });

  it("does not create a reference from a commented-out declaration", () => {
    const code = "// export function Page() {}\nexport const Other = 1;\n";
    assertEquals(ensureFilenameDefaultExport("Page.tsx", code), code);
  });

  it("preserves a real default export", () => {
    const code = "export default function Page() {}\n";
    assertEquals(ensureFilenameDefaultExport("Page.tsx", code), code);
  });

  it("preserves a namespace re-exported as default", () => {
    const code = 'export * as default from "./source.js";\nexport function Page() {}\n';
    assertEquals(ensureFilenameDefaultExport("Page.tsx", code), code);
  });

  it("supports aliased re-exports", () => {
    const code = 'export { Internal as Page } from "./internal.js";\n';
    assertEquals(
      ensureFilenameDefaultExport("Page.tsx", code),
      code + 'export { Internal as default } from "./internal.js";\n',
    );
  });
});
