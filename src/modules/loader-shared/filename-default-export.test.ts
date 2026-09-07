import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  ensureFilenameDefaultExport,
  inferFilenameDefaultExportName,
} from "./filename-default-export.ts";

describe("filename default exports", () => {
  it("infers the logical name from declarations and minified export lists", () => {
    for (const code of ["export function Widget() {}", "const w = {}; export { w as Widget };"]) {
      assertEquals(inferFilenameDefaultExportName("_vf_modules/Widget.js", code), "Widget");
      assertEquals(inferFilenameDefaultExportName("_vf_modules/Widget/index.js", code), null);
    }
  });

  it("preserves explicit default exports and unmatched logical names", () => {
    for (
      const code of [
        "export default function Widget() {}",
        "const w = {}; export { w as Widget, w as default };",
        "export const Other = {};",
      ]
    ) {
      assertEquals(inferFilenameDefaultExportName("Widget.js", code), null);
      assertEquals(ensureFilenameDefaultExport("Widget.js", code), code);
    }
  });

  it("keeps legacy local aliases and re-exports when adding a default", () => {
    assertEquals(
      ensureFilenameDefaultExport("Widget.js", "const w = {}; export { w as Widget };"),
      "const w = {}; export { w as Widget };\nexport { w as default };\n",
    );
    assertEquals(
      ensureFilenameDefaultExport("Widget.js", 'export { w as Widget } from "./child.js";'),
      'export { w as Widget } from "./child.js";\nexport { w as default } from "./child.js";\n',
    );
  });
});
