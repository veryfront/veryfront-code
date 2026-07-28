import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  normalizeModuleBranch,
  normalizeModuleProjectSlug,
  parseModuleRequestQuery,
} from "./module-request-query.ts";

function parse(query: string) {
  return parseModuleRequestQuery(new URL(`https://example.test/_vf_modules/page.js${query}`));
}

describe("modules/server/module-request-query", () => {
  it("returns decoded, bounded request identities", () => {
    assertEquals(
      parse("?project=demo-project&branch=feature%2Fdocs%20v2&t=123-abc"),
      {
        projectSlug: "demo-project",
        branch: "feature/docs v2",
        hmrToken: "123-abc",
      },
    );
  });

  it("rejects empty, repeated, and non-canonical project identities", () => {
    for (
      const query of [
        "?project=",
        "?project=first&project=second",
        "?project=not_canonical",
        "?project=%20demo",
      ]
    ) {
      assertThrows(() => parse(query), TypeError);
    }
  });

  it("rejects ambiguous or unsafe branch and HMR identities", () => {
    for (
      const query of [
        "?branch=",
        "?branch=one&branch=two",
        "?branch=%0Ahidden",
        "?t=",
        "?t=one&t=two",
        "?t=%00",
      ]
    ) {
      assertThrows(() => parse(query), TypeError);
    }
  });

  it("bounds aggregate query work and individual identities", () => {
    assertThrows(
      () => parse(`?${Array.from({ length: 65 }, (_, index) => `p${index}=x`).join("&")}`),
      RangeError,
    );
    assertThrows(
      () => parse(`?branch=${"b".repeat(1_025)}`),
      TypeError,
    );
    assertThrows(
      () => parse(`?t=${"t".repeat(257)}`),
      TypeError,
    );
  });

  it("validates identities supplied outside the request query", () => {
    assertEquals(normalizeModuleProjectSlug("demo"), "demo");
    assertEquals(normalizeModuleBranch("feature/docs"), "feature/docs");
    assertThrows(() => normalizeModuleProjectSlug("demo_project"), TypeError);
    assertThrows(() => normalizeModuleBranch(" branch "), TypeError);
  });
});
