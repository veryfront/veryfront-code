import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getErrorOverlay } from "./error-overlay.ts";

describe("server/handlers/dev/scripts/error-overlay", () => {
  it("does not render error-controlled content through overlay innerHTML", () => {
    const script = getErrorOverlay();

    assertEquals(script.includes("overlayElement.innerHTML"), false);
    assertEquals(script.includes("textContent = String(error.message"), true);
    assertEquals(script.includes("textContent = String(error.stack"), true);
  });
});
