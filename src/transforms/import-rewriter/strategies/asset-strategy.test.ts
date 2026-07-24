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

    it("matches the non-code file types a project is most likely to import", () => {
      for (
        const specifier of [
          "@/wasm/mod.wasm",
          "@/native/addon.node",
          "@/media/clip.mov",
          "@/content/notes.txt",
          "@/config/settings.yaml",
          "@/config/settings.yml",
          "@/data/rows.csv",
        ]
      ) {
        assertEquals(assetStrategy.matches(specifier, makeCtx()), true, specifier);
      }
    });

    it("leaves JSON alone, which is importable with an import attribute", () => {
      // `import manifest from "./manifest.json" with { type: "json" }` is
      // supported and the compile stage preserves the attribute. matches()
      // sees only the specifier, so it cannot tell the two apart.
      assertEquals(assetStrategy.matches("@/data/config.json", makeCtx()), false);
      assertEquals(assetStrategy.matches("./manifest.json", makeCtx()), false);
    });

    it("only claims specifiers the alias and relative strategies would resolve", () => {
      // Any other strategy owning the specifier knows where the file lives.
      // "Move it to public/" is not actionable for a file inside a dependency
      // or on another host, and the URL strategy already handles remote assets.
      for (
        const specifier of [
          "leaflet/dist/images/marker-icon.png",
          "https://cdn.example.com/icons/logo.svg",
          "http://cdn.example.com/icons/logo.svg",
          "veryfront/assets/logo.svg",
          "otherproject@1.0.0/@/assets/logo.svg",
        ]
      ) {
        assertEquals(assetStrategy.matches(specifier, makeCtx()), false, specifier);
      }
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

    it("keeps the directories under the alias root so two logos stay distinct", () => {
      const message = messageFromRewrite("@/assets/icons/logo.svg", makeCtx());
      assertStringIncludes(message, "public/icons/logo.svg");
      assertStringIncludes(message, '<img src="/icons/logo.svg" />');
    });

    it("keeps the directories a relative specifier walks into", () => {
      const message = messageFromRewrite("../images/photo.jpeg", makeCtx());
      assertStringIncludes(message, "public/images/photo.jpeg");
    });

    it("drops a query suffix from the suggested destination", () => {
      // Otherwise the advice reads "move the file to public/logo.svg?raw",
      // which names a file nobody can create.
      const message = messageFromRewrite("@/assets/logo.svg?raw", makeCtx());
      assertStringIncludes(message, "public/logo.svg");
      assertEquals(message.includes("logo.svg?raw and"), false);
      assertEquals(message.includes('src="/logo.svg?raw"'), false);
    });

    it("suggests a stylesheet rule for a font, not an image tag", () => {
      const message = messageFromRewrite("@/fonts/Inter.woff2", makeCtx());
      assertStringIncludes(message, "public/Inter.woff2");
      assertStringIncludes(message, "@font-face");
      assertStringIncludes(message, 'url("/Inter.woff2")');
      assertEquals(message.includes("<img"), false);
    });

    it("suggests a video tag for a video", () => {
      const message = messageFromRewrite("@/media/clip.mp4", makeCtx());
      assertStringIncludes(message, '<video src="/clip.mp4"');
      assertEquals(message.includes("<img"), false);
    });

    it("suggests the URL itself for a file with no element to render it", () => {
      const message = messageFromRewrite("@/docs/manual.pdf", makeCtx());
      assertStringIncludes(message, "public/manual.pdf");
      assertStringIncludes(message, "/manual.pdf");
      assertEquals(message.includes("<img"), false);
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

    it("does not treat a sibling directory with the same prefix as the project", () => {
      const message = messageFromRewrite(
        "./logo.png",
        makeCtx({ filePath: "/projectile/src/Header.tsx" }),
      );

      assertStringIncludes(message, "Header.tsx");
      assertEquals(message.includes("ile/src/Header.tsx"), false);
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
