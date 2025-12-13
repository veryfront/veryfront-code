import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { featuresToCapabilities, type RuntimeFeatures } from "./base.ts";

describe("platform/adapters/base", () => {
  describe("featuresToCapabilities", () => {
    it("should convert all features to capabilities with defaults", () => {
      const features: RuntimeFeatures = {
        typescript: true,
        jsx: true,
        http2: true,
        websocket: true,
        workers: true,
      };

      const capabilities = featuresToCapabilities(features);

      assertEquals(capabilities.typescript, true);
      assertEquals(capabilities.jsx, true);
      assertEquals(capabilities.http2, true);
      assertEquals(capabilities.websocket, true);
      assertEquals(capabilities.workers, true);
      assertEquals(capabilities.fileWatching, true);
      assertEquals(capabilities.shell, true);
      assertEquals(capabilities.kvStore, false);
      assertEquals(capabilities.writableFs, true);
    });

    it("should handle all false features", () => {
      const features: RuntimeFeatures = {
        typescript: false,
        jsx: false,
        http2: false,
        websocket: false,
        workers: false,
      };

      const capabilities = featuresToCapabilities(features);

      assertEquals(capabilities.typescript, false);
      assertEquals(capabilities.jsx, false);
      assertEquals(capabilities.http2, false);
      assertEquals(capabilities.websocket, false);
      assertEquals(capabilities.workers, false);
      assertEquals(capabilities.fileWatching, true);
      assertEquals(capabilities.shell, true);
      assertEquals(capabilities.kvStore, false);
      assertEquals(capabilities.writableFs, true);
    });

    it("should set default capabilities correctly", () => {
      const features: RuntimeFeatures = {
        typescript: true,
        jsx: false,
        http2: false,
        websocket: true,
        workers: false,
      };

      const capabilities = featuresToCapabilities(features);

      // Verify defaults are always applied
      assertEquals(capabilities.fileWatching, true, "fileWatching should default to true");
      assertEquals(capabilities.shell, true, "shell should default to true");
      assertEquals(capabilities.kvStore, false, "kvStore should default to false");
      assertEquals(capabilities.writableFs, true, "writableFs should default to true");
    });

    it("should preserve feature values in capabilities", () => {
      const features: RuntimeFeatures = {
        typescript: false,
        jsx: true,
        http2: false,
        websocket: true,
        workers: true,
      };

      const capabilities = featuresToCapabilities(features);

      assertEquals(capabilities.typescript, features.typescript);
      assertEquals(capabilities.jsx, features.jsx);
      assertEquals(capabilities.http2, features.http2);
      assertEquals(capabilities.websocket, features.websocket);
      assertEquals(capabilities.workers, features.workers);
    });
  });
});
