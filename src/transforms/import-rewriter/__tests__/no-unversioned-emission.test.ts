import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseEsmShUrl } from "../url-builder.ts";
import { urlStrategy } from "../strategies/url-strategy.ts";
import { bareStrategy } from "../strategies/bare-strategy.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";

/**
 * Acceptance criterion 1 of issue #240: no unversioned dependency URL is ever
 * emitted for a project inside the pinning cohort.
 *
 * This is a regression wall, not a driver: the behavior is implemented by
 * bare-strategy and url-strategy. If a case here fails, fix the strategy, not
 * the expectation.
 */
const DEPENDENCIES = Object.freeze({
  "lodash": "4.17.21",
  "@dnd-kit/core": "6.1.0",
  "recharts": "3.2.1",
  "zod": "3.25.76",
  "@radix-ui/react-dialog": "1.1.1",
});

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "emission-test",
    target: "browser",
    dev: false,
    reactVersion: "19.2.4",
    dependencyPinningCacheKey: "on:abc",
    dependencyPinningDependencies: DEPENDENCIES,
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

function emit(specifier: string, ctx: RewriteContext): string {
  const strategy = specifier.startsWith("https://") ? urlStrategy : bareStrategy;
  return strategy.rewrite(makeInfo(specifier), ctx).specifier ?? specifier;
}

/** Every specifier form a pinned project can present, URL and bare alike. */
const SPECIFIERS = [
  "https://esm.sh/lodash",
  "https://esm.sh/lodash/fp",
  "https://esm.sh/@dnd-kit/core",
  "https://esm.sh/@radix-ui/react-dialog/dist",
  "https://esm.sh/recharts?target=es2022",
  "https://esm.sh/zod",
  "lodash",
  "lodash/fp",
  "@dnd-kit/core",
  "recharts",
  "zod",
];

describe("no unversioned dependency URL is emitted for a pinned project", () => {
  for (const specifier of SPECIFIERS) {
    it(`should emit an exact version for ${specifier}`, () => {
      const emitted = emit(specifier, makeCtx());

      const parsed = parseEsmShUrl(emitted);
      assertEquals(
        parsed !== null,
        true,
        `expected an esm.sh URL, got ${emitted}`,
      );
      assertEquals(
        parsed?.version !== null,
        true,
        `emitted an unversioned dependency URL: ${emitted}`,
      );
    });
  }

  it("should emit the declared version, not merely some version", () => {
    for (const [packageName, version] of Object.entries(DEPENDENCIES)) {
      for (const specifier of [packageName, `https://esm.sh/${packageName}`]) {
        const emitted = emit(specifier, makeCtx());
        assertEquals(
          parseEsmShUrl(emitted)?.version,
          version,
          `wrong version for ${specifier}: ${emitted}`,
        );
      }
    }
  });
});
