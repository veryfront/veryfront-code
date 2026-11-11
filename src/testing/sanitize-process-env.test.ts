import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("sanitize-process-env", () => {
  it("removes both API credential names from the test process", async () => {
    const names = ["VERYFRONT_API_KEY", "VERYFRONT_API_TOKEN"];
    const previous = names.map((name) => Deno.env.get(name));
    try {
      for (const name of names) Deno.env.set(name, "test-only-value");
      // A unique query string forces the module body to run again.
      await import(`./sanitize-process-env.ts?run=${crypto.randomUUID()}`);
      for (const name of names) assertEquals(Deno.env.get(name), undefined);
    } finally {
      names.forEach((name, index) => {
        const value = previous[index];
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      });
    }
  });
});
