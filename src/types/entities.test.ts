import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { detectEntityType } from "./entities.ts";

describe("detectEntityType", () => {
  it("classifies layouts by filename conventions and frontmatter", () => {
    assertEquals(detectEntityType("layout.tsx").type, "layout");
    assertEquals(detectEntityType("MainLayout.tsx").isLayout, true);
    assertEquals(
      detectEntityType("article.mdx", { isLayout: true }).type,
      "layout",
    );
  });

  it("classifies PascalCase files as components and lowercase files as pages", () => {
    const button = detectEntityType("Button.tsx");

    assertEquals(
      button.type,
      "component",
      "PascalCase non-layout files classify as components",
    );
    assertEquals(
      button.isComponent,
      true,
      "PascalCase files set isComponent",
    );
    assertEquals(button.isPage, false, "components are not routable pages");

    const about = detectEntityType("about.tsx");

    assertEquals(about.type, "page", "lowercase files classify as pages");
    assertEquals(
      about.isComponent,
      false,
      "lowercase files are not components",
    );
  });

  it("treats dynamic routes as pages instead of components", () => {
    const result = detectEntityType("[slug].tsx");

    assertEquals(result.type, "page");
    assertEquals(result.isPage, true);
    assertEquals(result.isComponent, false);
  });

  it("treats routes that start with non-letters as pages", () => {
    const result = detectEntityType("2024-01-01.mdx");

    assertEquals(result.type, "page");
    assertEquals(result.isPage, true);
    assertEquals(result.isComponent, false);
  });

  it("normalizes supported script extensions to tsx kind", () => {
    assertEquals(detectEntityType("Button.tsx").kind, "tsx");
    assertEquals(detectEntityType("Button.ts").kind, "tsx");
    assertEquals(detectEntityType("Button.jsx").kind, "tsx");
    assertEquals(detectEntityType("Button.js").kind, "tsx");
    assertEquals(detectEntityType("content.mdx").kind, "mdx");
    assertEquals(detectEntityType("content.txt").kind, undefined);
  });
});
