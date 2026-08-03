import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertMatch, assertThrows } from "#veryfront/testing/assert";
import { createIdGenerator, generateId, generateUuid } from "./id.ts";

describe("id", () => {
  describe("generateUuid", () => {
    it("uses native randomUUID when available", () => {
      assertEquals(
        generateUuid({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }),
        "00000000-0000-4000-8000-000000000000",
      );
    });

    it("builds a version 4 UUID from secure random bytes", () => {
      const uuid = generateUuid({
        getRandomValues(bytes) {
          bytes.forEach((_, index) => bytes[index] = index);
          return bytes;
        },
      });

      assertEquals(uuid, "00010203-0405-4607-8809-0a0b0c0d0e0f");
    });

    it("fails explicitly when secure randomness is unavailable", () => {
      assertThrows(
        () => generateUuid(null),
        Error,
        "Web Crypto with getRandomValues is required",
      );
    });
  });

  describe("generateId", () => {
    it("should generate a 16-character ID without prefix", () => {
      const id = generateId();
      assertEquals(id.length, 16);
      assertMatch(id, /^[0-9a-zA-Z]{16}$/);
    });

    it("should generate ID with prefix", () => {
      assertMatch(generateId("msg"), /^msg-[0-9a-zA-Z]{16}$/);
    });

    it("should generate unique IDs", () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }

      assertEquals(ids.size, 100);
    });

    it("should draw alphabet characters without modulo bias", () => {
      // With `byte % 62`, the first 8 alphabet characters ("0"-"7") are drawn
      // at 5/256 each (8 * 5/256 ~= 0.1563 combined) instead of the uniform
      // 8/62 ~= 0.1290. The 0.145 midpoint threshold sits ~17 standard
      // deviations from both distributions at this sample size.
      let firstEightCount = 0;
      let totalCount = 0;

      for (let i = 0; i < 20_000; i++) {
        for (const char of generateId()) {
          totalCount++;
          if (char >= "0" && char <= "7") firstEightCount++;
        }
      }

      assertEquals(firstEightCount / totalCount < 0.145, true);
    });

    it("should not invoke a typed-array iterator replaced after module import", async () => {
      const idModuleUrl = new URL("./id.ts", import.meta.url).href;
      const source = `
        import { generateId } from ${JSON.stringify(idModuleUrl)};

        Uint8Array.prototype[Symbol.iterator] = function () {
          throw new Error("poisoned typed-array iterator");
        };
        console.log(generateId());
      `;
      const command = new Deno.Command(Deno.execPath(), {
        args: ["eval", "--no-check", "--frozen", "--config=deno.json", source],
        stdout: "piped",
        stderr: "piped",
      });

      const result = await command.output();
      const stderr = new TextDecoder().decode(result.stderr);
      assertEquals(result.success, true, stderr);
      assertMatch(new TextDecoder().decode(result.stdout).trim(), /^[0-9a-zA-Z]{16}$/);
    });
  });

  describe("createIdGenerator", () => {
    it("should reject invalid sizes", () => {
      for (
        const size of [
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER + 1,
          1_025,
        ]
      ) {
        assertThrows(() => createIdGenerator({ size }), RangeError);
      }
    });

    it("should create generator with prefix", () => {
      const generate = createIdGenerator({ prefix: "test" });
      assertMatch(generate(), /^test-[0-9a-zA-Z]{16}$/);
    });

    it("should use custom separator", () => {
      const generate = createIdGenerator({ prefix: "test", separator: "_" });
      assertMatch(generate(), /^test_[0-9a-zA-Z]{16}$/);
    });

    it("should use custom size", () => {
      const generate = createIdGenerator({ size: 8 });
      const id = generate();
      assertEquals(id.length, 8);
      assertMatch(id, /^[0-9a-zA-Z]{8}$/);
    });

    it("should generate without prefix", () => {
      const generate = createIdGenerator({});
      assertEquals(generate().length, 16);
    });
  });
});
