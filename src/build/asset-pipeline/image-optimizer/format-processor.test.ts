import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { processFormat } from "./format-processor.ts";
import type { SharpInstance } from "./types.ts";

function createMockSharp(): SharpInstance & { lastCall: { method: string; args: unknown[] } | null } {
  const mock: SharpInstance & { lastCall: { method: string; args: unknown[] } | null } = {
    lastCall: null,
    metadata: () => Promise.resolve({}),
    clone: () => mock,
    resize: () => mock,
    webp: function (options?) {
      mock.lastCall = { method: "webp", args: [options] };
      return mock;
    },
    avif: function (options?) {
      mock.lastCall = { method: "avif", args: [options] };
      return mock;
    },
    jpeg: function (options?) {
      mock.lastCall = { method: "jpeg", args: [options] };
      return mock;
    },
    png: function (options?) {
      mock.lastCall = { method: "png", args: [options] };
      return mock;
    },
    toBuffer: () => Promise.resolve(new Uint8Array()),
  };
  return mock;
}

describe("build/asset-pipeline/image-optimizer/format-processor", () => {
  describe("processFormat", () => {
    it("should process webp format with quality", () => {
      const mock = createMockSharp();
      const result = processFormat(mock, "webp", 80);
      assertEquals(result, mock);
      assertEquals(mock.lastCall?.method, "webp");
      assertEquals(mock.lastCall?.args, [{ quality: 80 }]);
    });

    it("should process avif format with quality", () => {
      const mock = createMockSharp();
      processFormat(mock, "avif", 60);
      assertEquals(mock.lastCall?.method, "avif");
      assertEquals(mock.lastCall?.args, [{ quality: 60 }]);
    });

    it("should process jpeg format with quality and progressive", () => {
      const mock = createMockSharp();
      processFormat(mock, "jpeg", 90);
      assertEquals(mock.lastCall?.method, "jpeg");
      assertEquals(mock.lastCall?.args, [{ quality: 90, progressive: true }]);
    });

    it("should process png format with compressionLevel and adaptiveFiltering", () => {
      const mock = createMockSharp();
      processFormat(mock, "png", 80);
      assertEquals(mock.lastCall?.method, "png");
      assertEquals(mock.lastCall?.args, [{ compressionLevel: 9, adaptiveFiltering: true }]);
    });

    it("should return image unchanged for unknown format", () => {
      const mock = createMockSharp();
      const result = processFormat(mock, "bmp" as never, 80);
      assertEquals(result, mock);
      assertEquals(mock.lastCall, null);
    });

    it("should handle quality 0", () => {
      const mock = createMockSharp();
      processFormat(mock, "webp", 0);
      assertEquals(mock.lastCall?.args, [{ quality: 0 }]);
    });

    it("should handle quality 100", () => {
      const mock = createMockSharp();
      processFormat(mock, "avif", 100);
      assertEquals(mock.lastCall?.args, [{ quality: 100 }]);
    });

    it("should return the SharpInstance for chaining", () => {
      const mock = createMockSharp();
      const result = processFormat(mock, "webp", 80);
      assertEquals(typeof result.toBuffer, "function");
      assertEquals(typeof result.resize, "function");
    });
  });
});
