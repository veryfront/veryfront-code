import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isAnimationDisabled, setAnimationDisabled } from "./animation.ts";

describe("animation", () => {
  it("defaults to false", () => {
    setAnimationDisabled(false);
    assertEquals(isAnimationDisabled(), false);
  });

  it("can be set to true", () => {
    setAnimationDisabled(true);
    assertEquals(isAnimationDisabled(), true);
    setAnimationDisabled(false);
  });

  it("can toggle back to false", () => {
    setAnimationDisabled(true);
    setAnimationDisabled(false);
    assertEquals(isAnimationDisabled(), false);
  });
});
