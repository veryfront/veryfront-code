import { describe, it } from "std/testing/bdd.ts";
import { assertExists } from "std/assert/mod.ts";

describe("AI client exports", () => {
  it("should export useChat from ai/react", async () => {
    const module = await import("./client.ts");
    assertExists(module.useChat);
  });

  it("should export useCompletion from ai/react", async () => {
    const module = await import("./client.ts");
    assertExists(module.useCompletion);
  });
});
