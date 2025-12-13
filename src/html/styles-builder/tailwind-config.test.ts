import { describe, it } from "std/testing/bdd.ts";
import { assert } from "std/assert/mod.ts";
import { getTailwindCDNUrl, generateTailwindConfig } from "./tailwind-config.ts";

describe("tailwind-config", () => {
  describe("getTailwindCDNUrl", () => {
    it("should return a CDN URL string", () => {
      const url = getTailwindCDNUrl();

      assert(typeof url === "string");
      assert(url.length > 0);
    });

    it("should handle custom config", () => {
      const customConfig = {
        theme: {
          extend: {
            colors: {
              custom: "#123456",
            },
          },
        },
      };

      const url = getTailwindCDNUrl(customConfig);

      assert(typeof url === "string");
    });
  });

  describe("generateTailwindConfig", () => {
    it("should return config string", () => {
      const config = generateTailwindConfig();

      assert(typeof config === "string");
    });

    it("should handle custom config", () => {
      const customConfig = {
        theme: {
          extend: {
            colors: {
              custom: "#123456",
            },
          },
        },
      };

      const config = generateTailwindConfig(customConfig);

      assert(typeof config === "string");
    });
  });
});
