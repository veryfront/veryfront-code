import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { embedSourceUrl, extractSourceUrl } from "./source-url-embed.ts";

describe("transforms/esm/source-url-embed", () => {
  describe("embedSourceUrl", () => {
    it("embeds source URL as preserved comment at start", () => {
      const code = "const x = 1;";
      const result = embedSourceUrl(code, "https://esm.sh/react@18");
      assertEquals(result, "/*! @vf-source: https://esm.sh/react@18 */\nconst x = 1;");
    });

    it("does not double-embed if already present", () => {
      const code = "/*! @vf-source: https://esm.sh/react@18 */\nconst x = 1;";
      const result = embedSourceUrl(code, "https://esm.sh/other");
      assertEquals(result, code);
    });

    it("handles empty code", () => {
      const result = embedSourceUrl("", "https://esm.sh/react@18");
      assertEquals(result, "/*! @vf-source: https://esm.sh/react@18 */\n");
    });

    it("handles empty URL", () => {
      const result = embedSourceUrl("code", "");
      assertEquals(result, "/*! @vf-source:  */\ncode");
    });
  });

  describe("extractSourceUrl", () => {
    it("extracts embedded source URL", () => {
      const code = "/*! @vf-source: https://esm.sh/react@18 */\nconst x = 1;";
      assertEquals(extractSourceUrl(code), "https://esm.sh/react@18");
    });

    it("returns null if no embedded URL", () => {
      assertEquals(extractSourceUrl("const x = 1;"), null);
    });

    it("returns null for empty string", () => {
      assertEquals(extractSourceUrl(""), null);
    });

    it("trims whitespace from extracted URL", () => {
      const code = "/*! @vf-source:   https://esm.sh/react@18   */\ncode";
      assertEquals(extractSourceUrl(code), "https://esm.sh/react@18");
    });

    it("roundtrips correctly", () => {
      const url = "https://esm.sh/react@18.2.0?target=es2022";
      const embedded = embedSourceUrl("const x = 1;", url);
      assertEquals(extractSourceUrl(embedded), url);
    });

    it("returns null if suffix marker is missing", () => {
      const code = "/*! @vf-source: https://esm.sh/react@18\nconst x = 1;";
      assertEquals(extractSourceUrl(code), null);
    });
  });
});
