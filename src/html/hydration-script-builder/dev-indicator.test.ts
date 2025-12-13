import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { generateDevIndicatorScript } from "./dev-indicator.ts";

describe("dev-indicator", () => {
  describe("generateDevIndicatorScript", () => {
    it("should generate script without nonce", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("<script>"));
      assert(!script.includes('nonce="'));
      assert(script.includes("</script>"));
    });

    it("should generate script with nonce attribute", () => {
      const nonce = "test-nonce-xyz";
      const script = generateDevIndicatorScript(nonce);

      assert(script.includes(`<script nonce="${nonce}">`));
    });

    it("should create IIFE", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("(function() {"));
      assert(script.includes("})();"));
    });

    it("should check sessionStorage for hidden state", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("sessionStorage.getItem('vf-dev-indicator-hidden')"));
      assert(script.includes("return;"));
    });

    it("should create indicator div element", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("document.createElement('div')"));
      assert(script.includes("indicator.className = 'dev-indicator'"));
    });

    it("should create text element with Development Mode", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("document.createElement('span')"));
      assert(script.includes("text.textContent = 'Development Mode'"));
      assert(script.includes("indicator.appendChild(text)"));
    });

    it("should create close button", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("document.createElement('button')"));
      assert(script.includes("closeBtn.className = 'dev-indicator-close'"));
      assert(script.includes("closeBtn.innerHTML = '&times;'"));
    });

    it("should add aria-label to close button", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("closeBtn.setAttribute('aria-label', 'Hide development mode indicator')"));
    });

    it("should handle close button click", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("closeBtn.onclick = function()"));
      assert(script.includes("indicator.remove()"));
      assert(script.includes("sessionStorage.setItem('vf-dev-indicator-hidden', '1')"));
    });

    it("should append indicator to body", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("document.body.appendChild(indicator)"));
    });

    it("should append close button to indicator", () => {
      const script = generateDevIndicatorScript();

      assert(script.includes("indicator.appendChild(closeBtn)"));
    });

    it("should handle empty string nonce", () => {
      const script = generateDevIndicatorScript("");

      assert(!script.includes('nonce=""'));
      assert(script.includes("<script>"));
    });

    it("should handle special characters in nonce", () => {
      const nonce = "abc-123_XYZ/+=";
      const script = generateDevIndicatorScript(nonce);

      assert(script.includes(`nonce="${nonce}"`));
    });
  });
});
