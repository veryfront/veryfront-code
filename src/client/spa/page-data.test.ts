import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PageDataResponse } from "./ClientApp.tsx";
import { snapshotLayoutInputs, snapshotPageData } from "./page-data.ts";

function createPageData(): PageDataResponse {
  return {
    slug: "/docs",
    pagePath: "pages/docs.tsx",
    pageType: "tsx",
    layouts: [{ kind: "tsx", path: "layouts/docs.tsx" }],
    providers: [],
    frontmatter: { title: "Docs" },
    props: { nested: { enabled: true } },
    params: { slug: ["guide", "intro"] },
    layoutProps: { "layouts/docs.tsx": { theme: "dark" } },
    headings: [{ id: "intro", text: "Introduction", level: 2 }],
    releaseAssetModules: { "pages/docs.tsx": "/assets/docs.js" },
  };
}

describe("client/spa/page-data", () => {
  it("creates a detached immutable snapshot", () => {
    const input = createPageData();
    const snapshot = snapshotPageData(input);

    (input.props.nested as { enabled: boolean }).enabled = false;
    input.layouts[0]!.path = "layouts/mutated.tsx";
    input.releaseAssetModules!["pages/docs.tsx"] = "/assets/mutated.js";

    assertEquals(snapshot.props, { nested: { enabled: true } });
    assertEquals(snapshot.layouts[0]?.path, "layouts/docs.tsx");
    assertEquals(snapshot.releaseAssetModules, {
      "pages/docs.tsx": "/assets/docs.js",
    });
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(snapshot.props.nested), true);
  });

  it("rejects accessors without invoking them", () => {
    const input = createPageData();
    let getterCalls = 0;
    Object.defineProperty(input.props, "privateValue", {
      enumerable: true,
      get() {
        getterCalls++;
        return "private";
      },
    });

    assertThrows(() => snapshotPageData(input), TypeError, "cannot be inspected");
    assertEquals(getterCalls, 0);
  });

  it("serializes dates without consulting instance overrides", () => {
    const input = createPageData();
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    let getterCalls = 0;
    Object.defineProperty(createdAt, "toISOString", {
      configurable: true,
      get() {
        getterCalls++;
        return () => "mutated";
      },
    });
    input.props.createdAt = createdAt;

    const snapshot = snapshotPageData(input);
    assertEquals(snapshot.props.createdAt, "2026-01-02T03:04:05.000Z");
    assertEquals(getterCalls, 0);
  });

  it("rejects cycles, sparse arrays, and unsupported values", () => {
    const cyclic = createPageData();
    cyclic.props.self = cyclic.props;
    assertThrows(() => snapshotPageData(cyclic), TypeError, "cycle");

    const sparse = createPageData();
    sparse.headings = new Array(2);
    assertThrows(() => snapshotPageData(sparse), TypeError, "cannot be inspected");

    const unsupported = createPageData();
    unsupported.props.callback = () => undefined;
    assertThrows(() => snapshotPageData(unsupported), TypeError, "JSON cannot represent");
  });

  it("enforces structural and resource limits", () => {
    const tooManyLayouts = createPageData();
    tooManyLayouts.layouts = Array.from(
      { length: 65 },
      (_, index) => ({ kind: "tsx" as const, path: `layouts/layout-${index}.tsx` }),
    );
    assertThrows(() => snapshotPageData(tooManyLayouts), TypeError, "layouts");

    const invalidHeading = createPageData();
    invalidHeading.headings = [{ id: "intro", text: "Intro", level: 7 }];
    assertThrows(() => snapshotPageData(invalidHeading), TypeError, "heading level");

    const oversizedCss = createPageData();
    oversizedCss.css = "😀".repeat(600_000);
    assertThrows(() => snapshotPageData(oversizedCss), TypeError, "Route CSS");

    const deep = createPageData();
    let nested: Record<string, unknown> = {};
    deep.props.deep = nested;
    for (let depth = 0; depth < 65; depth++) {
      const next: Record<string, unknown> = {};
      nested.next = next;
      nested = next;
    }
    assertThrows(() => snapshotPageData(deep), TypeError, "depth limit");

    const ambiguousCss = createPageData();
    ambiguousCss.cssAction = "clear";
    ambiguousCss.cssError = "unavailable";
    assertThrows(() => snapshotPageData(ambiguousCss), TypeError, "ambiguous");

    const unsafeSlug = createPageData();
    unsafeSlug.slug = "/docs\nprivate";
    assertThrows(() => snapshotPageData(unsafeSlug), TypeError, "slug");
  });

  it("validates standalone layout shell inputs", () => {
    const layouts = [{ kind: "tsx" as const, path: "layouts/docs.tsx" }];
    const layoutProps = { "layouts/docs.tsx": { theme: "dark" } };
    const snapshot = snapshotLayoutInputs(layouts, layoutProps, null, "release-1");

    layouts[0]!.path = "layouts/mutated.tsx";
    layoutProps["layouts/docs.tsx"].theme = "light";
    assertEquals(snapshot.layouts[0]?.path, "layouts/docs.tsx");
    assertEquals(snapshot.layoutProps["layouts/docs.tsx"], { theme: "dark" });
    assertEquals(snapshot.releaseId, "release-1");

    assertThrows(
      () => snapshotLayoutInputs([{ kind: "tsx", path: "../layout.tsx" }], {}),
      TypeError,
    );
    assertThrows(
      () => snapshotLayoutInputs(layouts, layoutProps, null, "release\n2"),
      TypeError,
    );
  });
});
