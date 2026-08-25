import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  MAX_CSS_FILES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
} from "#veryfront/utils/constants/css.ts";
import {
  cacheCSSAsync,
  clearCSSCache,
  extractCandidates,
  extractCandidatesFromFiles,
  formatCSSError,
  getCompilerCacheStats,
  getCSSByHash,
  getProjectCSS,
  hashCSS,
} from "./tailwind-compiler.ts";

describe("styles-builder/tailwind-compiler", () => {
  describe("extractCandidates", () => {
    it("should extract basic utility classes", () => {
      const candidates = extractCandidates('<div class="mt-4 bg-blue-500">');
      assertEquals(candidates.includes("mt-4"), true);
      assertEquals(candidates.includes("bg-blue-500"), true);
    });

    it("should extract negative values", () => {
      const candidates = extractCandidates('className="-mt-4 -translate-x-1/2"');
      assertEquals(candidates.includes("-mt-4"), true);
      assertEquals(candidates.includes("-translate-x-1/2"), true);
    });

    it("should extract important modifier", () => {
      const candidates = extractCandidates('class="!mt-4 !text-red-500"');
      assertEquals(candidates.includes("!mt-4"), true);
      assertEquals(candidates.includes("!text-red-500"), true);
    });

    it("should extract responsive/state variants", () => {
      const candidates = extractCandidates(
        'class="sm:mt-4 hover:bg-blue-500 dark:text-white"',
      );
      assertEquals(candidates.includes("sm:mt-4"), true);
      assertEquals(candidates.includes("hover:bg-blue-500"), true);
      assertEquals(candidates.includes("dark:text-white"), true);
    });

    it("should extract arbitrary values", () => {
      const candidates = extractCandidates('class="w-[100px] bg-[#ff0000]"');
      assertEquals(candidates.includes("w-[100px]"), true);
      assertEquals(candidates.includes("bg-[#ff0000]"), true);
    });

    it("should extract opacity modifiers", () => {
      const candidates = extractCandidates('class="bg-black/50 text-white/75"');
      assertEquals(candidates.includes("bg-black/50"), true);
      assertEquals(candidates.includes("text-white/75"), true);
    });

    it("should extract fractions", () => {
      const candidates = extractCandidates('class="w-1/2 h-3/4"');
      assertEquals(candidates.includes("w-1/2"), true);
      assertEquals(candidates.includes("h-3/4"), true);
    });

    it("should deduplicate results", () => {
      const candidates = extractCandidates('class="mt-4 mt-4 mt-4"');
      const mtCount = candidates.filter((c) => c === "mt-4").length;
      assertEquals(mtCount, 1);
    });

    it("should return empty array for content with no matches", () => {
      const candidates = extractCandidates("   \n\n   ");
      assertEquals(candidates.length, 0);
    });

    it("should return empty array for empty string", () => {
      const candidates = extractCandidates("");
      assertEquals(candidates.length, 0);
    });

    it("should extract container query syntax", () => {
      const candidates = extractCandidates('class="@container @lg:flex"');
      assertEquals(candidates.includes("@container"), true);
      assertEquals(candidates.includes("@lg:flex"), true);
    });

    it("should extract arbitrary properties", () => {
      const candidates = extractCandidates('class="[mask-type:alpha]"');
      assertEquals(candidates.includes("[mask-type:alpha]"), true);
    });

    it("should extract arbitrary variants", () => {
      const candidates = extractCandidates('class="[&>*]:mt-4"');
      assertEquals(candidates.includes("[&>*]:mt-4"), true);
    });

    it("should extract CSS variable utilities", () => {
      const candidates = extractCandidates('class="bg-[var(--color)]"');
      assertEquals(candidates.includes("bg-[var(--color)]"), true);
    });

    it("skips an overlong run whole instead of extracting fragments", () => {
      const admitted = "a".repeat(MAX_CSS_SELECTOR_TOKEN_CHARACTERS);
      const overlong = `${admitted}a`;

      assertEquals(extractCandidates(`class="${admitted}"`).includes(admitted), true);

      // The run is skipped entirely: no fragment of it becomes a candidate, and
      // scanning continues past it. This used to throw, and the throw reached
      // generateHTMLShellPartsImpl, so the request 500'd rather than degrading
      // to an unstyled page.
      const candidates = extractCandidates(`class="${overlong}" class="text-red-500"`);
      assertEquals(candidates.some((candidate) => /^a+$/.test(candidate)), false);
      assertEquals(candidates.includes("text-red-500"), true);
    });

    it("skips an over-cap run that ends without a continuation", () => {
      // The pattern's head admits up to five characters on top of its MAX - 1
      // body, so a match can reach MAX + 4 and stop at a clean boundary -- no
      // continuation follows, and only the length check catches it. Gating the
      // skip on continuation alone emitted the run as a candidate, which then
      // threw in normalizeCSSCandidates instead of at the tokenizer.
      for (const head of ["!", "@", "-", "!-@[&"]) {
        const overCap = `${head}${"a".repeat(MAX_CSS_SELECTOR_TOKEN_CHARACTERS)}`;
        const candidates = extractCandidates(`class="${overCap}" text-red-500`);

        for (const candidate of candidates) {
          assertEquals(candidate.length <= MAX_CSS_SELECTOR_TOKEN_CHARACTERS, true);
        }
        assertEquals(candidates.some((candidate) => /a{16}/.test(candidate)), false);
        assertEquals(candidates.includes("text-red-500"), true);
      }
    });

    it("admits a run sitting exactly on the cap", () => {
      const atCap = "a".repeat(MAX_CSS_SELECTOR_TOKEN_CHARACTERS);
      const candidates = extractCandidates(`class="${atCap}" text-red-500`);

      assertEquals(candidates.includes(atCap), true);
      assertEquals(candidates.includes("text-red-500"), true);
    });

    it("skips a multi-kilobyte run in one scan", () => {
      // esbuild writes `//# sourceMappingURL=data:application/json;base64,...`
      // into the build cache, and base64's alphabet lies entirely inside the
      // candidate body class, so the payload reads as one unbroken token.
      const payload = "AB/+=".repeat(20_000);
      const candidates = extractCandidates(
        `//# sourceMappingURL=data:application/json;base64,${payload}\nclass="text-red-500"`,
      );

      for (const candidate of candidates) {
        assertEquals(candidate.length <= MAX_CSS_SELECTOR_TOKEN_CHARACTERS, true);
      }
      assertEquals(candidates.includes("text-red-500"), true);
    });
  });

  describe("extractCandidatesFromFiles", () => {
    it("should extract candidates from .tsx files", () => {
      const files = [
        { path: "pages/index.tsx", content: '<div className="mt-4 flex">' },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("mt-4"), true);
      assertEquals(candidates.has("flex"), true);
    });

    it("should extract candidates from .jsx files", () => {
      const files = [
        {
          path: "components/button.jsx",
          content: '<button className="px-4 py-2">',
        },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("px-4"), true);
      assertEquals(candidates.has("py-2"), true);
    });

    it("should extract candidates from .ts files", () => {
      const files = [
        {
          path: "lib/utils.ts",
          content: 'const classes = "text-lg font-bold";',
        },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("text-lg"), true);
      assertEquals(candidates.has("font-bold"), true);
    });

    it("should extract candidates from .js files", () => {
      const files = [
        { path: "lib/helpers.js", content: 'const cls = "bg-red-500";' },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("bg-red-500"), true);
    });

    it("should extract candidates from .mdx files", () => {
      const files = [
        {
          path: "pages/blog.mdx",
          content: '<div className="prose max-w-none">',
        },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("prose"), true);
      assertEquals(candidates.has("max-w-none"), true);
    });

    it("should skip non-source files", () => {
      const files = [
        { path: "styles/globals.css", content: ".mt-4 { margin-top: 1rem; }" },
        { path: "data/config.json", content: '{"class": "mt-4"}' },
        { path: "README.md", content: "Use `mt-4` class" },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.size, 0);
    });

    it("should skip files without content", () => {
      const files = [
        { path: "pages/index.tsx" },
        { path: "components/card.tsx", content: undefined },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.size, 0);
    });

    it("should aggregate candidates from multiple files", () => {
      const files = [
        { path: "pages/index.tsx", content: '<div className="mt-4">' },
        { path: "components/card.tsx", content: '<div className="p-6 rounded">' },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("mt-4"), true);
      assertEquals(candidates.has("p-6"), true);
      assertEquals(candidates.has("rounded"), true);
    });

    it("should return a Set (no duplicates across files)", () => {
      const files = [
        { path: "pages/a.tsx", content: '<div className="flex">' },
        { path: "pages/b.tsx", content: '<div className="flex">' },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.size >= 1, true);

      const flexCount = [...candidates].filter((c) => c === "flex").length;
      assertEquals(flexCount, 1);
    });

    it("should handle empty file list", () => {
      const candidates = extractCandidatesFromFiles([]);
      assertEquals(candidates.size, 0);
    });

    it("rejects more files than the cap", () => {
      assertThrows(
        () => extractCandidatesFromFiles(new Array(MAX_CSS_FILES + 1)),
        TypeError,
        String(MAX_CSS_FILES),
        "the file-count cap must reject oversized input before any file is read",
      );
    });
  });

  describe("hashCSS", () => {
    it("should return a string hash", () => {
      const hash = hashCSS("body { color: red; }");
      assertEquals(typeof hash, "string");
      assertEquals(hash.length > 0, true);
    });

    it("should return consistent hash for same input", () => {
      const css = ".foo { color: blue; }";
      assertEquals(hashCSS(css), hashCSS(css));
    });

    it("should return different hashes for different input", () => {
      const hash1 = hashCSS(".foo { color: blue; }");
      const hash2 = hashCSS(".bar { color: red; }");
      assertEquals(hash1 !== hash2, true);
    });

    it("returns a full lowercase SHA-256 content identity", () => {
      const hash = hashCSS("some long css content with many rules .a .b .c {}");
      assertEquals(hash.length, 64);
      assertEquals(/^[a-f0-9]{64}$/.test(hash), true);
    });

    it("should handle empty string", () => {
      const hash = hashCSS("");
      assertEquals(typeof hash, "string");
    });
  });

  describe("formatCSSError", () => {
    it("should format plugin options not supported error", () => {
      const result = formatCSSError(
        'The plugin "@tailwindcss/forms" does not accept options',
      );
      assertEquals(result.title, "Plugin Options Not Supported");
      assertEquals(result.message.includes("@tailwindcss/forms"), true);
      assertEquals(result.suggestion.includes("@plugin"), true);
    });

    it("should format plugin not found error", () => {
      const result = formatCSSError(
        'Could not resolve plugin "tailwindcss-animate"',
      );
      assertEquals(result.title, "Plugin Not Available");
      assertEquals(result.message.includes("tailwindcss-animate"), true);
      assertEquals(result.suggestion.includes("explicitly registered provider"), true);
      // The provider resolves plugins from a pinned allowlist, so the suggestion
      // has to name the two specifier forms it accepts rather than only saying
      // the load failed.
      assertEquals(result.suggestion.includes("allowlist"), true);
      assertEquals(result.suggestion.includes("exact"), true);
    });

    it("should format failed to load plugin error", () => {
      const result = formatCSSError('Failed to load plugin "my-plugin"');
      assertEquals(result.title, "Plugin Not Available");
      assertEquals(result.message.includes("my-plugin"), true);
    });

    it("should format invalid @theme error", () => {
      const result = formatCSSError("Invalid theme value for --color-primary");
      assertEquals(result.title, "Invalid CSS Theme");
      assertEquals(result.suggestion.includes("processor"), true);
      // This branch only fires on a message that already names @theme, so the
      // suggestion can show the concrete declaration shape.
      assertEquals(result.suggestion.includes("@theme"), true);
    });

    it("should format @theme keyword error", () => {
      const result = formatCSSError("@theme block has syntax error");
      assertEquals(result.title, "Invalid CSS Theme");
    });

    it("should format unexpected token error", () => {
      const result = formatCSSError("Unexpected token at line 5");
      assertEquals(result.title, "CSS Syntax Error");
      assertEquals(result.suggestion.includes("configured CSS processor"), true);
      // Missing punctuation is plain-CSS advice that holds for any processor.
      assertEquals(result.suggestion.includes("semicolons"), true);
    });

    it("should format expected token error", () => {
      const result = formatCSSError("Expected closing brace");
      assertEquals(result.title, "CSS Syntax Error");
    });

    it("should format generic error", () => {
      const result = formatCSSError("Something went wrong");
      assertEquals(result.title, "CSS Compilation Error");
      assertEquals(result.message, "Something went wrong");
      assertEquals(result.suggestion.includes("stylesheet"), true);
    });

    it("should accept Error objects", () => {
      const result = formatCSSError(new Error("Test error message"));
      assertEquals(result.message, "Test error message");
    });

    it("should accept string errors", () => {
      const result = formatCSSError("String error");
      assertEquals(result.message, "String error");
    });
  });

  describe("getProjectCSS", () => {
    it("throws formatted error on invalid stylesheet", async () => {
      clearCSSCache();
      const badCss = `@theme { --color-primary: #fff`;
      await assertRejects(
        () => getProjectCSS("test-project", badCss, new Set(), { minify: false }),
        Error,
      );
    });
  });

  describe("getCSSByHash / clearCSSCache", () => {
    it("should return undefined for unknown hash", () => {
      clearCSSCache();
      assertEquals(getCSSByHash("nonexistent"), undefined);
      assertEquals(
        getCSSByHash("0".repeat(64)),
        undefined,
        "a valid digest with no entry must miss",
      );
    });

    it("should clear all caches", async () => {
      clearCSSCache();
      const css = ".vf-clear-probe { color: red; }";
      const hash = hashCSS(css);
      await cacheCSSAsync(css, hash);
      assertEquals(
        getCSSByHash(hash),
        css,
        "a cached entry must be readable by its content hash",
      );
      clearCSSCache();
      assertEquals(
        getCSSByHash(hash),
        undefined,
        "clearCSSCache must drop cached entries",
      );
    });
  });

  describe("getCompilerCacheStats", () => {
    it("should return stats object with correct shape", () => {
      const stats = getCompilerCacheStats();
      assertEquals(typeof stats.size, "number");
      assertEquals(typeof stats.maxSize, "number");
      assertEquals(Array.isArray(stats.entries), true);
    });

    it("should have maxSize of 10", () => {
      const stats = getCompilerCacheStats();
      assertEquals(stats.maxSize, 10);
    });

    it("should report size >= 0", () => {
      const stats = getCompilerCacheStats();
      assertEquals(stats.size >= 0, true);
    });
  });
});
