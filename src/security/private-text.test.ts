import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPrivateTextDecoder, encodePrivateText } from "./private-text.ts";
import { privateByteSubarray } from "./private-bytes.ts";
describe("private text codecs", () => {
  it("does not inherit decoding flags that change UTF-8 validation", () => {
    let reads = 0;
    const options = Object.create({
      get fatal() {
        reads++;
        return true;
      },
    }) as TextDecoderOptions;
    const decoder = createPrivateTextDecoder("utf-8", options);
    assertEquals(decoder.decode(new Uint8Array([0xff])), "\ufffd");
    const strict = createPrivateTextDecoder("utf-8", { fatal: true });
    const decodeOptions = Object.create({
      get stream() {
        reads++;
        return true;
      },
    }) as TextDecodeOptions;
    assertThrows(() => strict.decode(new Uint8Array([0xc3]), decodeOptions), TypeError);
    assertEquals(reads, 0);
  });

  it("retains independent decoder state and UTF-8 validation", () => {
    const bytes = encodePrivateText("å🙂");
    const first = createPrivateTextDecoder("utf-8", { fatal: true });
    const second = createPrivateTextDecoder("utf-8", { fatal: true });
    assertEquals(first.decode(privateByteSubarray(bytes, 0, 1), { stream: true }), "");
    assertEquals(second.decode(bytes), "å🙂");
    assertEquals(first.decode(privateByteSubarray(bytes, 1)), "å🙂");
    assertThrows(() => second.decode(new Uint8Array([0xff])), TypeError);
  });
});
