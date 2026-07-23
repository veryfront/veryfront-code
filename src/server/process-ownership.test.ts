import "#veryfront/schemas/_test-setup.ts";

import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ExclusiveProcessOwner } from "./process-ownership.ts";

describe("ExclusiveProcessOwner", () => {
  it("rejects a second live owner and permits a new generation after release", async () => {
    const ownership = new ExclusiveProcessOwner("test resource");
    const releaseFirst = ownership.acquire();

    await assertRejects(
      () => Promise.resolve().then(() => ownership.acquire()),
      Error,
      "already active",
    );

    releaseFirst();
    releaseFirst();
    const releaseSecond = ownership.acquire();
    releaseSecond();
  });
});
