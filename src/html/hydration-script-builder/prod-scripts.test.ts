import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getProdScripts } from "./prod-scripts.ts";

describe("prod-scripts", () => {
  describe("getProdScripts", () => {
    it("should return production hydration script", () => {
      const script = getProdScripts("test-page");

      assert(script.includes('<script type="module">'));
      assert(script.includes("import * as React from 'react'"));
    });

    it("should pass slug to hydration script", () => {
      const script = getProdScripts("my-page");

      assert(script.includes("@/pages/my-page"));
    });

    it("should pass props to hydration script", () => {
      const props = { title: "Test" };
      const script = getProdScripts("test-page", undefined, props);

      assert(script.includes(JSON.stringify(props)));
    });

    it("should pass nonce to hydration script", () => {
      const nonce = "test-nonce";
      const script = getProdScripts("test-page", undefined, undefined, nonce);

      assert(script.includes(`nonce="${nonce}"`));
    });

    it("should handle all parameters", () => {
      const params = { id: "123" };
      const props = { title: "Test" };
      const nonce = "nonce";
      const script = getProdScripts("test-page", params, props, nonce);

      assert(script.length > 0);
      assert(script.includes(`nonce="${nonce}"`));
    });
  });
});
