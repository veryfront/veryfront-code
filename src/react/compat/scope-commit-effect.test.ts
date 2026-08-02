import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { selectScopeCommitStrategy } from "./scope-commit-effect.ts";

describe("scope commit effect compatibility", () => {
  it("uses the insertion phase without render publication when available", () => {
    const strategy = selectScopeCommitStrategy({
      useEffect: React.useEffect,
      useLayoutEffect: React.useLayoutEffect,
      useInsertionEffect: React.useInsertionEffect,
    }, true);

    assertStrictEquals(strategy.effect, React.useInsertionEffect);
    assertEquals(strategy.publishDuringRender, false);
  });

  it("uses synchronous browser publication with a layout fallback for React 17", () => {
    const strategy = selectScopeCommitStrategy({
      useEffect: React.useEffect,
      useLayoutEffect: React.useLayoutEffect,
    }, true);

    assertStrictEquals(strategy.effect, React.useLayoutEffect);
    assertEquals(strategy.publishDuringRender, true);
  });

  it("uses the passive fallback during React 17 server rendering", () => {
    const strategy = selectScopeCommitStrategy({
      useEffect: React.useEffect,
      useLayoutEffect: React.useLayoutEffect,
    }, false);

    assertStrictEquals(strategy.effect, React.useEffect);
    assertEquals(strategy.publishDuringRender, true);
  });
});
