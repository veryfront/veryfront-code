import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { focusFirst, getFocusableElements } from "./focus-management.ts";

describe("focus management", () => {
  it("excludes fieldset-disabled controls, hidden details, and non-tab-stop radios", () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div id="panel" tabindex="-1">
        <fieldset disabled><input id="fieldset-input"></fieldset>
        <details><button id="hidden-details">Hidden</button></details>
        <input id="radio-a" type="radio" name="choice">
        <input id="radio-b" type="radio" name="choice" checked>
        <button id="action">Action</button>
      </div>
    </body>`);
    try {
      const panel = dom.window.document.getElementById("panel") as HTMLElement;
      assertEquals(
        getFocusableElements(panel).map((element) => element.id),
        ["radio-b", "action"],
      );
    } finally {
      dom.window.close();
    }
  });

  it("falls back to the container when a reported candidate cannot receive focus", async () => {
    const dom = new JSDOM(
      '<!doctype html><body><button id="outside">Outside</button><div id="panel" tabindex="-1"><button id="broken">Broken</button></div></body>',
      { pretendToBeVisual: true },
    );
    try {
      const document = dom.window.document;
      const panel = document.getElementById("panel") as HTMLElement;
      const outside = document.getElementById("outside") as HTMLElement;
      const broken = document.getElementById("broken") as HTMLElement;
      broken.focus = () => undefined;
      outside.focus();

      focusFirst(panel);

      assertEquals(document.activeElement, panel);
      // Moving focus collapses the selection, and jsdom fires the resulting
      // `selectionchange` from a 0ms timer the way a browser does. Yield once so
      // it completes before Deno's leak sanitizer inspects the test.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      dom.window.close();
    }
  });
});
