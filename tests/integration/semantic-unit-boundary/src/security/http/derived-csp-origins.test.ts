import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deriveCspOriginsFromSource } from "#veryfront/security/http/derived-csp-origins.ts";
import { withTestContext } from "../../../../../_helpers/context.ts";

function integrationTest(
  name: string,
  action: () => void | Promise<void>,
): void {
  it(name, async () => {
    await withTestContext(name, async () => {
      await action();
    });
  });
}

function origins(content: string): readonly string[] {
  const derived = deriveCspOriginsFromSource([{
    path: "pages/index.mdx",
    content,
  }]);
  return derived["img-src"] ?? [];
}

describe("security/http/derived-csp-origins semantic boundaries", () => {
  integrationTest(
    "breaks equal-count cap ties by code-unit order before slicing",
    () => {
      const originalLocaleCompare = String.prototype.localeCompare;
      String.prototype.localeCompare = function (_other: string): number {
        return -1;
      };
      try {
        const many = Array.from(
          { length: 40 },
          (_, i) => `https://h${String(i).padStart(2, "0")}.example.com/x`,
        ).join("\n");
        assertEquals(origins(many), [
          "https://h00.example.com",
          "https://h01.example.com",
          "https://h02.example.com",
          "https://h03.example.com",
          "https://h04.example.com",
          "https://h05.example.com",
          "https://h06.example.com",
          "https://h07.example.com",
          "https://h08.example.com",
          "https://h09.example.com",
          "https://h10.example.com",
          "https://h11.example.com",
          "https://h12.example.com",
          "https://h13.example.com",
          "https://h14.example.com",
          "https://h15.example.com",
          "https://h16.example.com",
          "https://h17.example.com",
          "https://h18.example.com",
          "https://h19.example.com",
          "https://h20.example.com",
          "https://h21.example.com",
          "https://h22.example.com",
          "https://h23.example.com",
          "https://h24.example.com",
          "https://h25.example.com",
          "https://h26.example.com",
          "https://h27.example.com",
          "https://h28.example.com",
          "https://h29.example.com",
          "https://h30.example.com",
          "https://h31.example.com",
        ]);
      } finally {
        String.prototype.localeCompare = originalLocaleCompare;
      }
    },
  );
});
