import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCSSCache,
  extractCandidates,
  extractCandidatesFromFiles,
  formatCSSError,
  getCompilerCacheStats,
  getCSSByHash,
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
      const candidates = extractCandidates('class="sm:mt-4 hover:bg-blue-500 dark:text-white"');
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
        { path: "components/button.jsx", content: '<button className="px-4 py-2">' },
      ];
      const candidates = extractCandidatesFromFiles(files);
      assertEquals(candidates.has("px-4"), true);
      assertEquals(candidates.has("py-2"), true);
    });

    it("should extract candidates from .ts files", () => {
      const files = [
        { path: "lib/utils.ts", content: 'const classes = "text-lg font-bold";' },
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
        { path: "pages/blog.mdx", content: '<div className="prose max-w-none">' },
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
      // "flex" should only appear once in the Set
      const flexCount = [...candidates].filter((c) => c === "flex").length;
      assertEquals(flexCount, 1);
    });

    it("should handle empty file list", () => {
      const candidates = extractCandidatesFromFiles([]);
      assertEquals(candidates.size, 0);
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

    it("should return max 8 characters", () => {
      const hash = hashCSS("some long css content with many rules .a .b .c {}");
      assertEquals(hash.length <= 8, true);
    });

    it("should handle empty string", () => {
      const hash = hashCSS("");
      assertEquals(typeof hash, "string");
    });
  });

  describe("formatCSSError", () => {
    it("should format plugin not found error", () => {
      const result = formatCSSError('Could not resolve plugin "tailwindcss-animate"');
      assertEquals(result.title, "Plugin Not Found");
      assertEquals(result.message.includes("tailwindcss-animate"), true);
      assertEquals(result.suggestion.includes("esm.sh"), true);
    });

    it("should format failed to load plugin error", () => {
      const result = formatCSSError('Failed to load plugin "my-plugin"');
      assertEquals(result.title, "Plugin Not Found");
      assertEquals(result.message.includes("my-plugin"), true);
    });

    it("should format invalid @theme error", () => {
      const result = formatCSSError("Invalid theme value for --color-primary");
      assertEquals(result.title, "Invalid @theme");
      assertEquals(result.suggestion.includes("@theme"), true);
    });

    it("should format @theme keyword error", () => {
      const result = formatCSSError("@theme block has syntax error");
      assertEquals(result.title, "Invalid @theme");
    });

    it("should format unexpected token error", () => {
      const result = formatCSSError("Unexpected token at line 5");
      assertEquals(result.title, "CSS Syntax Error");
      assertEquals(result.suggestion.includes("semicolons"), true);
    });

    it("should format expected token error", () => {
      const result = formatCSSError("Expected closing brace");
      assertEquals(result.title, "CSS Syntax Error");
    });

    it("should format generic error", () => {
      const result = formatCSSError("Something went wrong");
      assertEquals(result.title, "Tailwind CSS Error");
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

  describe("getCSSByHash / clearCSSCache", () => {
    it("should return undefined for unknown hash", () => {
      clearCSSCache();
      assertEquals(getCSSByHash("nonexistent"), undefined);
    });

    it("should clear all caches", () => {
      clearCSSCache();
      // After clearing, any lookup should return undefined
      assertEquals(getCSSByHash("any-hash"), undefined);
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
