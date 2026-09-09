import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cleanContent } from "./provider-message-content.ts";

describe("provider message content", () => {
  it("checks private content without invoking its own some override", () => {
    const content = [{ type: "text", text: "synthetic private provider content" }];
    let observations = 0;
    Object.defineProperty(content, "some", {
      value: function (this: typeof content, ...args: Parameters<typeof content.some>) {
        observations++;
        return Reflect.apply(Array.prototype.some, this, args);
      },
    });
    assertEquals(cleanContent(content, "user"), [{ type: "text", text: content[0]!.text }]);
    assertEquals(observations, 0);
  });
});
