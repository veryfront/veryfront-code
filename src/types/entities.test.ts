import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { detectEntityType, type Frontmatter, normalizeFrontmatter } from "./entities.ts";

const parsedDate = new Date("2026-07-18T00:00:00.000Z");
const parsedFrontmatter: Frontmatter = {
  tags: "release",
  date: parsedDate,
  layout: false,
  author: "Ada",
  custom: { nested: true },
  mixed: ["release", 2],
  nullable: null,
  numeric: [1, 2],
};
const layoutFrontmatter: Frontmatter = { isLayout: true };
const layoutFlag: boolean | undefined = layoutFrontmatter.isLayout;

describe("detectEntityType", () => {
  it("classifies layouts by filename conventions and frontmatter", () => {
    assertEquals(detectEntityType("layout.tsx").type, "layout");
    assertEquals(detectEntityType("MainLayout.tsx").isLayout, true);
    assertEquals(detectEntityType("main-layout.tsx").isLayout, true);
    assertEquals(
      detectEntityType("article.mdx", { isLayout: true }).type,
      "layout",
    );
  });

  it("does not treat ordinary page names containing layout as layouts", () => {
    const result = detectEntityType("layout-guide.mdx");

    assertEquals(result.type, "page");
    assertEquals(result.isPage, true);
    assertEquals(result.isLayout, false);
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
    assertEquals(detectEntityType("content.md").kind, "mdx");
    assertEquals(detectEntityType("content.txt").kind, undefined);
  });

  it("models raw frontmatter values returned by the parser", () => {
    assertEquals(parsedFrontmatter.tags, "release");
    assertEquals(parsedFrontmatter.date, parsedDate);
    assertEquals(parsedFrontmatter.layout, false);
    assertEquals(parsedFrontmatter.author, "Ada");
    assertEquals(parsedFrontmatter.custom, { nested: true });
    assertEquals(parsedFrontmatter.mixed, ["release", 2]);
    assertEquals(parsedFrontmatter.nullable, null);
    assertEquals(parsedFrontmatter.numeric, [1, 2]);
    assertEquals(layoutFlag, true);
  });

  it("fails closed when a frontmatter layout flag cannot be inspected", () => {
    const unreadableFrontmatter = new Proxy({}, {
      get() {
        throw new Error("frontmatter proxy detail");
      },
    }) as Frontmatter;

    assertEquals(detectEntityType("article.mdx", unreadableFrontmatter).type, "page");
  });

  it("does not invoke a frontmatter layout accessor", () => {
    let accessorReads = 0;
    const frontmatter = Object.defineProperty({}, "isLayout", {
      get() {
        accessorReads++;
        return true;
      },
    }) as Frontmatter;

    assertEquals(detectEntityType("article.mdx", frontmatter).type, "page");
    assertEquals(accessorReads, 0);
  });
});

describe("normalizeFrontmatter", () => {
  it("copies data properties without invoking accessors or mutating prototypes", () => {
    let accessorReads = 0;
    const parsed = Object.create(null);
    Object.defineProperty(parsed, "title", { enumerable: true, value: "Safe title" });
    Object.defineProperty(parsed, "__proto__", { enumerable: true, value: "metadata" });
    Object.defineProperty(parsed, "computed", {
      enumerable: true,
      get() {
        accessorReads++;
        return "unsafe";
      },
    });

    const normalized = normalizeFrontmatter(parsed);

    assertEquals(normalized.title, "Safe title");
    assertEquals(Object.hasOwn(normalized, "__proto__"), true);
    assertEquals(normalized["__proto__"], "metadata");
    assertEquals(Object.hasOwn(normalized, "computed"), false);
    assertEquals(accessorReads, 0);
    assertEquals(Object.getPrototypeOf(normalized), Object.prototype);
  });

  it("returns an empty record when parsed properties cannot be inspected", () => {
    const unreadable = new Proxy({}, {
      ownKeys() {
        throw new Error("frontmatter descriptor failure");
      },
    });

    assertEquals(normalizeFrontmatter(unreadable), {});
  });

  it("removes invalid parsed dates", () => {
    const normalized = normalizeFrontmatter({
      date: new Date(Number.NaN),
      preserved: "metadata",
    });

    assertEquals(normalized.date, undefined);
    assertEquals(normalized.preserved, "metadata");
  });

  it("clones tag arrays without invoking indexed accessors", () => {
    const tags = ["release"];
    const normalized = normalizeFrontmatter({ tags });

    tags[0] = "mutated";

    assertEquals(normalized.tags, ["release"]);
    assertEquals(normalized.tags === tags, false);

    let accessorReads = 0;
    const accessorTags: string[] = [];
    Object.defineProperty(accessorTags, "0", {
      enumerable: true,
      get() {
        accessorReads++;
        return "computed";
      },
    });
    accessorTags.length = 1;

    const accessorResult = normalizeFrontmatter({ tags: accessorTags });

    assertEquals(accessorResult.tags, undefined);
    assertEquals(accessorReads, 0);
  });

  it("validates dates with the intrinsic method", () => {
    let accessorReads = 0;
    const date = new Date("2026-07-21T00:00:00.000Z");
    Object.defineProperty(date, "getTime", {
      get() {
        accessorReads++;
        throw new Error("date accessor must not run");
      },
    });

    const normalized = normalizeFrontmatter({ date });

    assertEquals(normalized.date === date, false);
    assertEquals(
      Date.prototype.getTime.call(normalized.date),
      Date.parse("2026-07-21T00:00:00.000Z"),
    );
    assertEquals(accessorReads, 0);

    date.setUTCFullYear(2030);
    assertEquals(normalized.date, new Date("2026-07-21T00:00:00.000Z"));
  });
});
