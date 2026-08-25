import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { isAnimationDisabled, setAnimationDisabled } from "./animation.ts";

describe("animation", () => {
  const colorTerminal = createInMemoryHostRuntime({ env: { TERM: "xterm-256color" } });

  afterEach(() => {
    setAnimationDisabled(false);
  });

  it("defaults to false", () => {
    assertEquals(isAnimationDisabled(colorTerminal), false, "animation is enabled by default");
  });

  it("can be set to true", () => {
    setAnimationDisabled(true);
    assertEquals(isAnimationDisabled(colorTerminal), true, "the flag disables animation");
  });

  it("can toggle back to false", () => {
    setAnimationDisabled(true);
    setAnimationDisabled(false);
    assertEquals(isAnimationDisabled(colorTerminal), false, "clearing the flag re-enables");
  });

  describe("TERM=dumb detection", () => {
    it("returns true when TERM=dumb", () => {
      const host = createInMemoryHostRuntime({ env: { TERM: "dumb" } });
      assertEquals(isAnimationDisabled(host), true, "a dumb terminal disables animation");
    });

    it("returns false when TERM is not dumb", () => {
      assertEquals(isAnimationDisabled(colorTerminal), false, "a capable terminal animates");
    });

    it("returns false when TERM is unset", () => {
      const host = createInMemoryHostRuntime();
      assertEquals(isAnimationDisabled(host), false, "no TERM does not disable animation");
    });
  });
});
