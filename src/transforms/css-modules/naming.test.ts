import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCssModuleScope,
  normalizeCssModuleKey,
  resolveCssModuleKey,
  rewriteCssModuleContent,
  rewriteCssModuleContentWithinLimit,
  toScopedCssModuleClass,
} from "./naming.ts";

describe("css-modules/naming", () => {
  it("resolves relative and alias module keys deterministically", () => {
    const relative = resolveCssModuleKey(
      "./Button.module.css",
      "/project/pages/home/index.tsx",
      "/project",
    );
    const alias = resolveCssModuleKey(
      "@/styles/Button.module.css",
      "/project/pages/index.tsx",
      "/project",
    );

    assertEquals(
      relative,
      "/project/pages/home/Button.module.css",
      "relative specifiers resolve against the importing file directory",
    );
    assertEquals(
      alias,
      "/project/styles/Button.module.css",
      "@/ aliases resolve against the project directory",
    );
    assertEquals(
      resolveCssModuleKey(
        "../styles/Button.module.css",
        "/project/pages/home/index.tsx",
        "/project",
      ),
      "/project/pages/styles/Button.module.css",
      "parent segments collapse so one stylesheet keeps one module key",
    );
    assertEquals(
      resolveCssModuleKey(
        "../styles/Button.module.css",
        "/project/pages/home/index.tsx",
        "/project",
      ),
      resolveCssModuleKey(
        "./Button.module.css",
        "/project/pages/styles/index.tsx",
        "/project",
      ),
      "the same file resolves to the same key from either importer",
    );
  });

  it("normalizes module keys", () => {
    assertEquals(
      normalizeCssModuleKey("file:///p/Button.module.css?v=2#x"),
      "/p/Button.module.css",
      "strips the file:// prefix and the query/hash suffix",
    );
    assertEquals(
      normalizeCssModuleKey("C:\\p\\/Button.module.css"),
      "/C:/p/Button.module.css",
      "converts backslashes and collapses duplicate slashes",
    );
    assertEquals(
      getCssModuleScope("file:///p/Button.module.css?v=2").hash,
      getCssModuleScope("/p/Button.module.css").hash,
      "suffixed and plain keys hash identically",
    );
  });

  it("generates stable scoped class names", () => {
    const key = "/project/components/Button.module.css";
    const first = toScopedCssModuleClass(key, "container");
    const second = toScopedCssModuleClass(key, "container");
    const different = toScopedCssModuleClass(key, "header");

    assertEquals(first, second, "the same module key and local name are stable");
    assertEquals(
      first === different,
      false,
      "different local names get different scoped classes",
    );
    assertEquals(
      first.startsWith("Button_container__"),
      true,
      "the scoped class keeps the module base and the local name",
    );

    const inModuleA = toScopedCssModuleClass("/a/Button.module.css", "container");
    const inModuleB = toScopedCssModuleClass("/b/Button.module.css", "container");

    assertEquals(
      inModuleA === inModuleB,
      false,
      "same class name in different module keys must get different hash segments",
    );
    assertEquals(
      inModuleA.startsWith("Button_container__"),
      true,
      "base and local name stay stable across module keys",
    );
    assertEquals(
      inModuleB.startsWith("Button_container__"),
      true,
      "base and local name stay stable across module keys",
    );
  });

  it("rewrites module selectors and preserves :global()", () => {
    const key = normalizeCssModuleKey("/project/components/Button.module.css");
    const css = `
.container { color: red; }
:global(.prose) .container { margin: 0; }
`;

    const rewritten = rewriteCssModuleContent(css, key);

    assertEquals(rewritten.includes(".Button_container__"), true);
    assertEquals(rewritten.includes(":global(.prose)"), true);
  });

  it("rewrites compound selectors like .a.b", () => {
    const key = normalizeCssModuleKey("/project/components/Card.module.css");
    const css = `.container.active { color: red; }`;

    const rewritten = rewriteCssModuleContent(css, key);

    assertEquals(rewritten.includes(".Card_container__"), true);
    assertEquals(rewritten.includes(".Card_active__"), true);
    // Original unsoped class names should not remain
    assertEquals(rewritten.includes(".container"), false);
    assertEquals(rewritten.includes(".active {"), false);
  });

  it("enforces the exact rewritten UTF-8 byte boundary", () => {
    const admitted = rewriteCssModuleContentWithinLimit(
      ".aé\ud800",
      "/m.module.css",
      17,
    );

    assertEquals(admitted, {
      content: ".m_a__gqlim6é\ud800",
      byteLength: 17,
    });
    assertThrows(
      () => rewriteCssModuleContentWithinLimit(".aé\ud800", "/m.module.css", 16),
      TypeError,
      "16 bytes",
    );
  });

  it("rejects repeated-selector expansion before emitting an oversized result", () => {
    const content = ".a".repeat(512 * 1024);

    assertThrows(
      () => rewriteCssModuleContentWithinLimit(content, "/m.module.css", 1024 * 1024),
      TypeError,
      "1048576 bytes",
    );
  });

  it("preserves comments, strings, authored mask-like text, and flat globals", () => {
    const content = '__VF_CSS_GLOBAL_0__{/* .comment */content:".string"}:global(.prose) .local{}';
    const expected =
      '__VF_CSS_GLOBAL_0__{/* .comment */content:".string"}:global(.prose) .m_local__gqlim6{}';

    assertEquals(rewriteCssModuleContent(content, "/m.module.css"), expected);
    assertEquals(
      rewriteCssModuleContentWithinLimit(content, "/m.module.css", 1_000),
      { content: expected, byteLength: 86 },
    );
  });

  it("ignores quoted closing parentheses while finding a flat :global span", () => {
    assertEquals(
      rewriteCssModuleContent(
        ':global([data-x=")"]) .local { color:red }',
        "/m.module.css",
      ),
      ':global([data-x=")"]) .m_local__gqlim6 { color:red }',
    );
  });

  it("ignores commented closing parentheses while finding a flat :global span", () => {
    assertEquals(
      rewriteCssModuleContent(
        ":global(.external/* ) */ .also-external) .local {}",
        "/m.module.css",
      ),
      ":global(.external/* ) */ .also-external) .m_local__gqlim6 {}",
    );
  });

  it("rejects unsafe output byte limits", () => {
    for (const maximumBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => rewriteCssModuleContentWithinLimit("", "/m.module.css", maximumBytes),
        RangeError,
        "non-negative safe integer",
      );
    }
  });

  it("admits empty output at a zero-byte budget without allocating output code units", () => {
    const NativeUint16Array = globalThis.Uint16Array;
    let outputBufferCodeUnits = 0;
    class RecordingUint16Array extends NativeUint16Array {
      constructor(length: number) {
        outputBufferCodeUnits += length;
        super(length);
      }
    }
    Object.defineProperty(globalThis, "Uint16Array", {
      configurable: true,
      value: RecordingUint16Array,
      writable: true,
    });

    try {
      assertThrows(
        () => rewriteCssModuleContentWithinLimit(".a", "/m.module.css", 0),
        TypeError,
        "0 bytes",
      );
      assertEquals(outputBufferCodeUnits, 0);
      assertEquals(
        rewriteCssModuleContentWithinLimit("", "/m.module.css", 0),
        { content: "", byteLength: 0 },
      );
      assertEquals(outputBufferCodeUnits, 0);
    } finally {
      Object.defineProperty(globalThis, "Uint16Array", {
        configurable: true,
        value: NativeUint16Array,
        writable: true,
      });
    }
  });
});
