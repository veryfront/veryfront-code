import { describe, it } from "@std/testing/bdd";
import { ensureEsbuildBinary } from "./binary.ts";

describe("ensureEsbuildBinary runtime guards", () => {
  it("is a no-op under Node where Deno is absent", async () => {
    await ensureEsbuildBinary();
  });
});
