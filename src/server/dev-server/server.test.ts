import "#veryfront/schemas/_test-setup.ts";

import { assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { DevServer } from "./server.ts";

describe("DevServer lifecycle", () => {
  it("shares shutdown and never permits startup after shutdown begins", async () => {
    const server = new DevServer({
      projectDir: "/project",
      port: 3_000,
    });

    const firstStop = server.stop();
    const concurrentStop = server.stop();
    assertStrictEquals(firstStop, concurrentStop);
    await firstStop;
    assertStrictEquals(server.stop(), firstStop);

    await assertRejects(
      () => server.ready,
      Error,
      "stopped before becoming ready",
    );
    await assertRejects(
      () => server.start(),
      Error,
      "after shutdown has begun",
    );
  });
});
