import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { urlStrategy } from "../strategies/url-strategy.ts";
import { bareStrategy } from "../strategies/bare-strategy.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";

/**
 * Issue #240 acceptance criterion: two renders of an unchanged draft resolve
 * byte-identical dependency sets. Before pinning, a floating version could
 * change the library under a user or an agent mid-session.
 */
const DEPENDENCIES = Object.freeze({
  "lodash": "4.17.21",
  "recharts": "3.2.1",
  "@dnd-kit/core": "6.1.0",
});

function makeCtx(): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "determinism-test",
    target: "browser",
    dev: false,
    reactVersion: "19.2.4",
    dependencyPinningCacheKey: "on:abc",
    dependencyPinningDependencies: DEPENDENCIES,
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

const SPECIFIERS = [
  "https://esm.sh/lodash",
  "https://esm.sh/@dnd-kit/core",
  "https://esm.sh/recharts?target=es2022",
  "recharts",
  "lodash",
  "@dnd-kit/core",
];

function emit(specifier: string): string {
  const strategy = specifier.startsWith("https://") ? urlStrategy : bareStrategy;
  return strategy.rewrite(makeInfo(specifier), makeCtx()).specifier ?? specifier;
}

function renderAll(order: readonly string[] = SPECIFIERS): string[] {
  return order.map(emit);
}

describe("dependency pinning determinism", () => {
  it("should produce byte-identical output across repeated renders", () => {
    const first = renderAll();
    for (let round = 0; round < 5; round++) {
      assertEquals(renderAll(), first);
    }
  });

  it("should not depend on the order specifiers are rewritten in", () => {
    const forward = renderAll();
    const reversed = renderAll([...SPECIFIERS].reverse());
    assertEquals(reversed.reverse(), forward);
  });

  it("should resolve a URL and its bare equivalent to the same version", () => {
    // The two forms reach different strategies; a drift between them would
    // load two copies of the same library into one page.
    for (const packageName of Object.keys(DEPENDENCIES)) {
      const fromBare = emit(packageName);
      const fromUrl = emit(`https://esm.sh/${packageName}`);
      const version = DEPENDENCIES[packageName as keyof typeof DEPENDENCIES];
      assertEquals(fromBare.includes(`${packageName}@${version}`), true, fromBare);
      assertEquals(fromUrl.includes(`${packageName}@${version}`), true, fromUrl);
    }
  });
});
