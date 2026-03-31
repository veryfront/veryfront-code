import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildUrl } from "./command.ts";

describe("Open Command", () => {
  describe("buildUrl", () => {
    it("builds dashboard URL", () => {
      const url = buildUrl("my-app", { studio: false });
      assertEquals(url, "https://veryfront.com/projects/my-app");
    });

    it("builds studio URL", () => {
      const url = buildUrl("my-app", { studio: true });
      assertEquals(url, "https://veryfront.com/studio/my-app");
    });

    it("builds environment URL", () => {
      const url = buildUrl("my-app", { env: "staging", studio: false });
      assertEquals(
        url,
        "https://veryfront.com/projects/my-app/environments/staging",
      );
    });
  });
});
