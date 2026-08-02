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
