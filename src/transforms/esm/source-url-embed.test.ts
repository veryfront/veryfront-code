import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { embedSourceUrl, extractSourceUrl } from "./source-url-embed.ts";

describe("transforms/esm/source-url-embed", () => {
  describe("embedSourceUrl", () => {
    it("embeds source URL as a preserved comment at the start", () => {
      const code = "export default 42;";
      const result = embedSourceUrl(code, "https://esm.sh/react@18");
      assertEquals(result.startsWith("/*! @vf-source: https://esm.sh/react@18 */"), true);
      assertEquals(result.includes("export default 42;"), true);
    });

    it("does not double-embed if already present", () => {
      const code = "/*! @vf-source: https://esm.sh/react@18 */\nexport default 42;";
      const result = embedSourceUrl(code, "https://esm.sh/react@18");
      assertEquals(result, code);
    });

    it("does not double-embed with different URL", () => {
      const code = "/*! @vf-source: https://esm.sh/react@18 */\nexport default 42;";
      const result = embedSourceUrl(code, "https://esm.sh/lodash@4");
      assertEquals(result, code);
    });
  });

  describe("extractSourceUrl", () => {
    it("extracts embedded source URL", () => {
      const code = "/*! @vf-source: https://esm.sh/react@18 */\nexport default 42;";
      assertEquals(extractSourceUrl(code), "https://esm.sh/react@18");
    });

    it("returns null for code without embedded URL", () => {
      assertEquals(extractSourceUrl("export default 42;"), null);
    });

    it("returns null for empty string", () => {
      assertEquals(extractSourceUrl(""), null);
    });

    it("roundtrips through embed and extract", () => {
      const url = "https://esm.sh/some-pkg@1.2.3?external=react&target=es2022";
      const code = embedSourceUrl("const x = 1;", url);
      assertEquals(extractSourceUrl(code), url);
    });
  });
});
