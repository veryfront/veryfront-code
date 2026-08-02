import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { quoteDiagnosticString } from "./diagnostic-string.ts";

describe("quoteDiagnosticString()", () => {
  it("escapes C1, record-separator, and bidi controls", () => {
    const controls = [
      0x007f,
      ...Array.from({ length: 32 }, (_, index) => 0x0080 + index),
      0x061c,
      0x200e,
      0x200f,
      0x2028,
      0x2029,
      ...Array.from({ length: 5 }, (_, index) => 0x202a + index),
      ...Array.from({ length: 4 }, (_, index) => 0x2066 + index),
    ];

    for (const code of controls) {
      const hex = code.toString(16).padStart(4, "0");
      assertEquals(
        quoteDiagnosticString(`left${String.fromCodePoint(code)}right`),
        `"left\\u${hex}right"`,
      );
    }
  });

  it("preserves printable Unicode while JSON-escaping C0 controls", () => {
    assertEquals(quoteDiagnosticString("résumé-文件.ts"), '"résumé-文件.ts"');
    assertEquals(quoteDiagnosticString("line\nnext"), '"line\\nnext"');
  });
});
