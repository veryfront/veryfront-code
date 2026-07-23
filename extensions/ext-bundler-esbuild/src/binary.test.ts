import { describe, it } from "@std/testing/bdd";

import { ensureEsbuildBinary } from "./binary.ts";

describe("ensureEsbuildBinary", () => {
  it("is a no-op when the runtime is not a compiled Deno binary", async () => {
    await ensureEsbuildBinary();
  });
});
