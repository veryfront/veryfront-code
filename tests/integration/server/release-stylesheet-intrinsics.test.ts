/** Shared prototype mutations belong in integration, outside colocated unit tests. */
import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findStylesheetFromFiles } from "#veryfront/html/styles-builder/css-pregeneration.ts";

describe("authenticated release stylesheet intrinsic isolation", () => {
  it("protects configured and default path matching from tenant hooks", () => {
    const files = [{ path: "project/styles/custom.css", content: "custom" }, {
      path: "project/globals.css",
      content: "global",
    }];
    const endsWith = String.prototype.endsWith;
    const test = RegExp.prototype.test;
    const exec = RegExp.prototype.exec;
    const iterator = Array.prototype[Symbol.iterator];
    const apply = Reflect.apply;
    let configured;
    let fallback;
    try {
      String.prototype.endsWith = function (...args: Parameters<typeof endsWith>) {
        if (this === "project/styles/custom.css") throw new Error("Tenant read release path");
        return apply(endsWith, this, args);
      };
      RegExp.prototype.test = function (value: string) {
        if (value === "project/globals.css") throw new Error("Tenant read default release path");
        return apply(test, this, [value]);
      };
      RegExp.prototype.exec = function (value: string) {
        if (value === "project/globals.css") throw new Error("Tenant exec read release path");
        return apply(exec, this, [value]);
      };
      Array.prototype[Symbol.iterator] = function () {
        if (this[0] instanceof RegExp) return apply(iterator, [], []);
        return apply(iterator, this, []);
      };
      configured = findStylesheetFromFiles(files, "/styles/custom.css");
      fallback = findStylesheetFromFiles(files);
    } finally {
      String.prototype.endsWith = endsWith;
      RegExp.prototype.test = test;
      RegExp.prototype.exec = exec;
      Array.prototype[Symbol.iterator] = iterator;
    }
    assertEquals(configured, "custom");
    assertEquals(fallback, "global");
  });

  for (const configuredPath of ["styles/custom.css", undefined]) {
    it(`protects ${configuredPath ? "configured" : "default"} stylesheet sources from tenant find`, () => {
      const files = [
        { path: "veryfront.config.ts", content: "authenticated config" },
        { path: "styles/custom.css", content: "authenticated custom" },
        { path: "globals.css", content: "authenticated globals" },
      ];
      const originalFind = Array.prototype.find;
      const apply = Reflect.apply;
      let intercepted = 0;
      let stylesheet;
      try {
        Array.prototype.find = function (...args: Parameters<typeof originalFind>) {
          if (this === files) {
            intercepted++;
            return { path: "globals.css", content: "tenant stylesheet" };
          }
          return apply(originalFind, this, args);
        };
        stylesheet = findStylesheetFromFiles(files, configuredPath);
      } finally {
        Array.prototype.find = originalFind;
      }
      assertEquals(stylesheet, configuredPath ? "authenticated custom" : "authenticated globals");
      assertEquals(intercepted, 0);
    });
  }
});
