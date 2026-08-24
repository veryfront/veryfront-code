import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { PageDataResponse } from "./page-data.ts";
import { MAX_SPA_RESOURCE_KEY_LENGTH } from "./validation.ts";
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

  it("rejects page-authored arrays beyond the per-array length cap", () => {
    const pageData = validPageData();
    pageData.props = {
      values: Array.from({ length: 65_537 }, (_, index) => index),
    };

    assertThrows(
      () => snapshotPageData(pageData),
      TypeError,
      "props must contain at most 65535 entries",
      "a single array longer than the remaining budget is rejected by the length check",
    );
  });

  it("rejects page-authored data that exceeds the aggregate budget across containers", () => {
    const wide = (size: number) =>
      Object.fromEntries(Array.from({ length: size }, (_, index) => [String(index), 0]));

    const siblings = validPageData();
    siblings.props = { a: wide(40_000), b: wide(40_000) };
    assertThrows(
      () => snapshotPageData(siblings),
      TypeError,
      "65536",
      "the aggregate entry budget must reject two containers that are each individually legal",
    );

    const split = validPageData();
    split.frontmatter = { a: wide(40_000) };
    split.props = { b: wide(40_000) };
    assertThrows(
      () => snapshotPageData(split),
      TypeError,
      "65536",
      "the aggregate entry budget is shared by frontmatter, props and layoutProps",
    );
  });

  it("rejects page-authored data nested beyond the depth cap", () => {
    const nest = (levels: number) => {
      let node: Record<string, unknown> = {};
      for (let index = 0; index < levels; index++) node = { child: node };
      return node;
    };

    const tooDeep = validPageData();
    tooDeep.props = { root: nest(63) };
    assertThrows(
      () => snapshotPageData(tooDeep),
      TypeError,
      "nested at most 64 levels",
      "data past the depth cap is rejected by the module rather than the runtime stack",
    );

    const withinCap = validPageData();
    withinCap.props = { root: nest(62) };
    assertEquals(
      typeof snapshotPageData(withinCap).props.root,
      "object",
      "data just inside the depth cap is still captured",
    );
  });

  it("captures and validates the redirect branch", () => {
    const withRedirect = validPageData();
    withRedirect.redirect = { destination: "/next", permanent: true };

    const snapshot = snapshotPageData(withRedirect);
    assertEquals(
      snapshot.redirect,
      { destination: "/next", permanent: true },
      "a valid redirect survives the snapshot",
    );
    assertEquals(Object.isFrozen(snapshot.redirect), true, "the captured redirect is frozen");

    assertThrows(
      () => snapshotPageData({ ...validPageData(), redirect: { destination: "/next\n" } }),
      TypeError,
      "redirect.destination",
      "a control character in the redirect destination is rejected",
    );
    assertThrows(
      () =>
        snapshotPageData({
          ...validPageData(),
          redirect: { destination: `/${"x".repeat(MAX_SPA_RESOURCE_KEY_LENGTH)}` },
        }),
      TypeError,
      "redirect.destination",
      "an over-long redirect destination is rejected",
    );

    const looseFlag = validPageData();
    looseFlag.redirect = { destination: "/next", permanent: "yes" as unknown as boolean };
    assertEquals(
      snapshotPageData(looseFlag).redirect,
      { destination: "/next" },
      "a non-boolean permanent is dropped rather than copied",
    );
  });

  it("freezes the control-surface collections it rebuilds", () => {
    const pageData = validPageData();
    pageData.layouts = [{ kind: "tsx", path: "layouts/main.tsx" }];
    pageData.providers = ["providers/theme.tsx"];
    pageData.params = { slug: "home", tags: ["a", "b"] };

    const snapshot = snapshotPageData(pageData);

    assertEquals(
      Object.isFrozen(snapshot.layouts),
      true,
      "the layouts array is frozen so a later caller cannot append a layout",
    );
    assertEquals(
      Object.isFrozen(snapshot.layouts[0]),
      true,
      "each layout entry is frozen so its path cannot be rewritten after capture",
    );
    assertEquals(
      Object.isFrozen(snapshot.providers),
      true,
      "the providers array is frozen so a later caller cannot append a provider",
    );
    assertEquals(
      Object.isFrozen(snapshot.params),
      true,
      "the params record is frozen so a later caller cannot add a route parameter",
    );
    assertEquals(
      Object.isFrozen(snapshot.params.tags),
      true,
      "multi-segment route parameters are frozen too",
    );
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
