import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PageDataResponse } from "./page-data.ts";
import { snapshotPageData } from "./page-data.ts";

function validPageData(): PageDataResponse {
  return {
    slug: "/home",
    pagePath: "pages/home.tsx",
    pageType: "tsx",
    layouts: [],
    providers: [],
    frontmatter: {},
    props: {},
    params: {},
    layoutProps: {},
  };
}

describe("client/spa/page-data", () => {
  it("captures data properties without executing accessors", () => {
    let reads = 0;
    const pageData = validPageData() as PageDataResponse & Record<string, unknown>;
    Object.defineProperty(pageData, "pagePath", {
      enumerable: true,
      get() {
        reads++;
        return "pages/unsafe.tsx";
      },
    });

    assertThrows(() => snapshotPageData(pageData), TypeError);
    assertEquals(reads, 0);
  });

  it("rejects accessor-backed nested control records without invoking them", () => {
    let reads = 0;
    const pageData = validPageData();
    Object.defineProperty(pageData.props, "value", {
      enumerable: true,
      get() {
        reads++;
        return "unsafe";
      },
    });

    assertThrows(() => snapshotPageData(pageData), TypeError);
    assertEquals(reads, 0);
  });

  it("deeply snapshots and freezes page-authored data", () => {
    const pageData = validPageData();
    pageData.frontmatter = {
      social: { image: "original.png" },
    };
    pageData.props = {
      profile: { name: "Original", tags: ["stable"] },
    };
    pageData.layoutProps = {
      "layouts/main.tsx": {
        theme: { color: "blue" },
      },
    };

    const snapshot = snapshotPageData(pageData);
    const sourceFrontmatter = pageData.frontmatter.social as Record<string, unknown>;
    const sourceProfile = pageData.props.profile as Record<string, unknown>;
    const sourceTags = sourceProfile.tags as string[];
    const sourceLayoutTheme = pageData.layoutProps["layouts/main.tsx"]!.theme as Record<
      string,
      unknown
    >;
    sourceFrontmatter.image = "mutated.png";
    sourceProfile.name = "Mutated";
    sourceTags.push("mutated");
    sourceLayoutTheme.color = "red";

    assertEquals(snapshot.frontmatter, {
      social: { image: "original.png" },
    });
    assertEquals(snapshot.props, {
      profile: { name: "Original", tags: ["stable"] },
    });
    assertEquals(snapshot.layoutProps, {
      "layouts/main.tsx": {
        theme: { color: "blue" },
      },
    });
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.frontmatter.social), true);
    assertEquals(Object.isFrozen((snapshot.props.profile as Record<string, unknown>).tags), true);
    assertEquals(
      Object.isFrozen(snapshot.layoutProps["layouts/main.tsx"]!.theme),
      true,
    );
  });

  it("rejects deeply nested accessors without invoking them", () => {
    let reads = 0;
    const nested: Record<string, unknown> = {};
    Object.defineProperty(nested, "secret", {
      enumerable: true,
      get() {
        reads++;
        return "unsafe";
      },
    });
    const pageData = validPageData();
    pageData.props = { nested };

    assertThrows(() => snapshotPageData(pageData), TypeError);
    assertEquals(reads, 0);
  });

  it("rejects non-JSON nested values instead of silently changing them", () => {
    const pageData = validPageData();
    pageData.props = { createdAt: new Date(0) };

    assertThrows(() => snapshotPageData(pageData), TypeError);
  });

  it("rejects circular page-authored data", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const pageData = validPageData();
    pageData.props = { circular };

    assertThrows(() => snapshotPageData(pageData), TypeError);
  });

  it("rejects page-authored data beyond the aggregate entry budget", () => {
    const pageData = validPageData();
    pageData.props = {
      values: Array.from({ length: 65_537 }, (_, index) => index),
    };

    assertThrows(() => snapshotPageData(pageData), TypeError);
  });

  it("rejects sparse or accessor-backed arrays at admission", () => {
    const sparse = validPageData();
    sparse.providers = new Array(1);
    assertThrows(() => snapshotPageData(sparse), TypeError);

    let reads = 0;
    const accessorBacked = validPageData();
    Object.defineProperty(accessorBacked.layouts, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads++;
        return { kind: "tsx", path: "layouts/unsafe.tsx" };
      },
    });
    accessorBacked.layouts.length = 1;

    assertThrows(() => snapshotPageData(accessorBacked), TypeError);
    assertEquals(reads, 0);
  });

  it("bounds route parameter keys, values, and segment counts", () => {
    for (
      const params of [
        { ["x".repeat(2_049)]: "value" },
        { slug: "x".repeat(2_049) },
        { slug: ["safe", "line\nbreak"] },
        { slug: Array.from({ length: 513 }, () => "segment") },
      ]
    ) {
      const pageData = validPageData();
      pageData.params = params;
      assertThrows(() => snapshotPageData(pageData), TypeError);
    }
  });
});
