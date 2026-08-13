import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInitialState, updateServer } from "../state.ts";
import { renderEmptyState } from "./dashboard.ts";
import { renderStartup } from "./startup.ts";

describe("CLI app presentation", () => {
  it("renders startup status without a decorative box or mascot", () => {
    const output = renderStartup({
      steps: [{ label: "Loading configuration", status: "active" }],
      ready: false,
      frame: 0,
    });

    assertStringIncludes(output, "Loading configuration");
    assertEquals(output.includes("╭"), false);
    assertEquals(output.includes("╰"), false);
  });

  it("renders dashboard status without a decorative box or mascot", () => {
    const state = updateServer({
      port: 3000,
      url: "http://localhost:3000",
    })(createInitialState());
    const output = renderEmptyState(state);

    assertStringIncludes(output, "http://localhost:3000");
    assertEquals(output.includes("╭"), false);
    assertEquals(output.includes("╰"), false);
  });
});
