import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { assetStrategy } from "./asset-strategy.ts";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/test/y-image-import.tsx",
    projectDir: "/project",
    projectId: "test",
    target: "browser",
    dev: true,
    reactVersion: "19.1.1",
    ...overrides,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

/** Run the rewrite and return the message it rejects with. */
function messageFromRewrite(specifier: string, ctx: RewriteContext): string {
  try {
    assetStrategy.rewrite(makeInfo(specifier), ctx);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected rewrite to reject for ${specifier}`);
}

describe("AssetStrategy", () => {
  describe("matches", () => {
    it("matches static asset extensions", () => {
      for (
        const specifier of [
          "@/assets/logo.svg",
          "./icon.png",
          "../images/photo.jpeg",
          "@/media/clip.mp4",
          "@/fonts/Inter.woff2",
          "@/docs/manual.pdf",
        ]
      ) {
        assertEquals(assetStrategy.matches(specifier, makeCtx()), true, specifier);
      }
    });

    it("ignores a query string when matching", () => {
      assertEquals(assetStrategy.matches("@/assets/logo.svg?raw", makeCtx()), true);
    });

    it("does not match code modules", () => {
      for (
        const specifier of ["@/lib/constants", "./Button.tsx", "react", "@/lib/svg-utils.ts"]
      ) {
        assertEquals(assetStrategy.matches(specifier, makeCtx()), false, specifier);
      }
    });

    it("does not match CSS, which is supported and stripped earlier", () => {
      assertEquals(assetStrategy.matches("@/styles/globals.css", makeCtx()), false);
      assertEquals(assetStrategy.matches("./Button.module.css", makeCtx()), false);
    });
  });

  describe("rewrite", () => {
    // The previous behaviour fell through to "no known extension, append .js"
    // and emitted assets/logo.svg.js, so the failure named a file the author
    // never wrote: Module not found "file:///_vf_modules/assets/logo.svg.js".
    it("rejects with the file, the reason, and the supported alternative", () => {
      const message = messageFromRewrite("@/assets/logo.svg", makeCtx());
      assertStringIncludes(message, "@/assets/logo.svg");
      assertStringIncludes(message, "pages/test/y-image-import.tsx");
      assertStringIncludes(message, "public/logo.svg");
      assertStringIncludes(message, '<img src="/logo.svg" />');
      assertStringIncludes(message, "docs/guides/project-structure.md");
    });

    it("drops query strings from the suggested public filename", () => {
      const message = messageFromRewrite("@/assets/logo.svg?raw", makeCtx());
      assertStringIncludes(message, "@/assets/logo.svg?raw");
      assertStringIncludes(message, "public/logo.svg");
      assertStringIncludes(message, '<img src="/logo.svg" />');
      assertEquals(message.includes("public/logo.svg?raw"), false);
      assertEquals(message.includes('src="/logo.svg?raw"'), false);
    });

    it("names the importer relative to the project root", () => {
      const message = messageFromRewrite(
        "./logo.png",
        makeCtx({ filePath: "/project/components/Header.tsx" }),
      );
      assertStringIncludes(message, "components/Header.tsx");
      assertStringIncludes(message, "public/logo.png");
    });

    it("does not put a path outside the project in the message", () => {
      const message = messageFromRewrite(
        "./logo.png",
        makeCtx({ filePath: "/var/folders/kx/T/vf-bundle-1234/Header.tsx" }),
      );

      assertStringIncludes(message, "Header.tsx");
      assertEquals(message.includes("/var/folders/"), false);
    });

    it("uses no dash characters that the copy rules forbid", () => {
      const message = messageFromRewrite("@/assets/logo.svg", makeCtx());
      assertEquals(/[–—]/.test(message), false);
    });
  });

  it("runs before the alias and relative strategies", () => {
    // Otherwise they claim the specifier first and append .js to it.
    assertEquals(assetStrategy.priority < 1, true);
  });
});
