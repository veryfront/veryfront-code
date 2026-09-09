import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { execPrivateRegExp, replacePrivateRegExp, testPrivateRegExp } from "./private-regexp.ts";

describe("private regex operations", () => {
  it("matches global and frozen sticky patterns without changing caller state", () => {
    const global = /private/g;
    assertEquals(testPrivateRegExp(global, "private text"), true);
    assertEquals(testPrivateRegExp(global, "private text"), true);
    assertEquals(global.lastIndex, 0);
    const sticky = /private/y;
    sticky.lastIndex = 7;
    Object.freeze(sticky);
    assertEquals(execPrivateRegExp(sticky, "prefix private")?.index, 7);
    assertEquals(testPrivateRegExp(sticky, "prefix private"), true);
    assertEquals(sticky.lastIndex, 7);
  });

  it("retains captures and replacement substitutions without caller matcher overrides", () => {
    const pattern = /(private)-(text)/g;
    let observations = 0;
    Object.defineProperty(pattern, "exec", {
      value() {
        observations++;
        return null;
      },
    });
    assertEquals(
      replacePrivateRegExp(pattern, "private-text private-text", "$2:$1"),
      "text:private text:private",
    );
    assertEquals(pattern.lastIndex, 0);
    assertEquals(execPrivateRegExp(/(private)-(text)/, "private-text")?.[1], "private");
    assertEquals(testPrivateRegExp(/private/, "private-text"), true);
    assertEquals(testPrivateRegExp(/absent/, "private-text"), false);
    assertEquals(observations, 0);
  });

  it("preserves sticky positions and frozen input patterns", () => {
    const pattern = /private/y;
    pattern.lastIndex = 7;
    Object.freeze(pattern);
    assertEquals(replacePrivateRegExp(pattern, "prefix private", "kept"), "prefix kept");
    assertEquals(pattern.lastIndex, 7);
    assertEquals(replacePrivateRegExp(/PRIVATE/gi, "private Private", "kept"), "kept kept");
  });
});
