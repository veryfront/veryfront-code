import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPrivateReadableStream } from "./private-stream.ts";

describe("private stream construction", () => {
  it("preserves callback receivers while ignoring inherited source and strategy callbacks", async () => {
    let inheritedReads = 0;
    let receivers = 0;
    const source = Object.create({
      get start() {
        inheritedReads++;
        return undefined;
      },
    }, {
      pull: {
        value: function (
          this: UnderlyingDefaultSource<string>,
          controller: ReadableStreamDefaultController<string>,
        ) {
          if (this === source) receivers++;
          controller.enqueue("Synthetic output");
          controller.close();
        },
        enumerable: true,
      },
    }) as UnderlyingDefaultSource<string>;
    const strategy = Object.create({
      get size() {
        inheritedReads++;
        return () => 1;
      },
    }) as QueuingStrategy<string>;
    assertEquals(await Array.fromAsync(createPrivateReadableStream(source, strategy)), [
      "Synthetic output",
    ]);
    assertEquals(inheritedReads, 0);
    assertEquals(receivers, 1);
  });
});
