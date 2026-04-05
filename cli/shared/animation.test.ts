import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isAnimationDisabled, setAnimationDisabled } from "./animation.ts";

describe("animation", () => {
  let originalTerm: string | undefined;

  beforeEach(() => {
    originalTerm = Deno.env.get("TERM");
  });

  afterEach(() => {
    if (originalTerm !== undefined) {
      Deno.env.set("TERM", originalTerm);
    } else {
      Deno.env.delete("TERM");
    }
    setAnimationDisabled(false);
  });

  it("defaults to false", () => {
    Deno.env.set("TERM", "xterm-256color");
    assertEquals(isAnimationDisabled(), false);
  });

  it("can be set to true", () => {
    setAnimationDisabled(true);
    assertEquals(isAnimationDisabled(), true);
  });

  it("can toggle back to false", () => {
    Deno.env.set("TERM", "xterm-256color");
    setAnimationDisabled(true);
    setAnimationDisabled(false);
    assertEquals(isAnimationDisabled(), false);
  });

  describe("TERM=dumb detection", () => {
    it("returns true when TERM=dumb", () => {
      Deno.env.set("TERM", "dumb");
      assertEquals(isAnimationDisabled(), true);
    });

    it("returns false when TERM is not dumb", () => {
      Deno.env.set("TERM", "xterm-256color");
      assertEquals(isAnimationDisabled(), false);
    });
  });
});
