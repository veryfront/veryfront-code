import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cleanContent } from "./provider-message-content.ts";

describe("provider message content", () => {
  it("checks attachment fields without invoking inherited or own accessors", () => {
    let reads = 0;
    const prototype = Object.create(null, {
      filename: {
        get() {
          reads++;
          return undefined;
        },
      },
      data: {
        get() {
          reads++;
          return undefined;
        },
      },
    });
    const part = Object.assign(Object.create(prototype), {
      type: "image",
      mediaType: "image/png",
      url: "data:image/png;base64,c3ludGhldGlj",
    });
    assertEquals(cleanContent([part], "user").length, 1);
    Object.defineProperty(part, "filename", {
      get() {
        reads++;
        return undefined;
      },
    });
    assertEquals(cleanContent([part], "user").length, 1);
    assertEquals(reads, 0);
  });
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
