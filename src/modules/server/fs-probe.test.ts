import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findFirstExistingFile } from "./fs-probe.ts";

describe("modules/server/fs-probe", () => {
  it("uses candidate order rather than probe completion order", async () => {
    const found = await findFirstExistingFile(
      {
        async stat(path) {
          if (path === "first") await Promise.resolve();
          return { isFile: true };
        },
      },
      ["first", "second"],
    );

    assertEquals(found, "first");
  });

  it("treats not-found probes as misses", async () => {
    const found = await findFirstExistingFile(
      {
        stat(path) {
          if (path === "missing") {
            return Promise.reject(new Deno.errors.NotFound("missing"));
          }
          return Promise.resolve({ isFile: true });
        },
      },
      ["missing", "present"],
    );

    assertEquals(found, "present");
  });

  it("propagates operational probe failures", async () => {
    const denied = new Deno.errors.PermissionDenied("denied");
    await assertRejects(
      () =>
        findFirstExistingFile(
          {
            stat(path) {
              return path === "denied" ? Promise.reject(denied) : Promise.resolve({ isFile: true });
            },
          },
          ["denied", "present"],
        ),
      Deno.errors.PermissionDenied,
      "denied",
    );
  });

  it("ignores an irrelevant lower-priority failure after selecting a preferred file", async () => {
    const found = await findFirstExistingFile(
      {
        stat(path) {
          return path === "preferred"
            ? Promise.resolve({ isFile: true })
            : Promise.reject(new Deno.errors.PermissionDenied("irrelevant fallback"));
        },
      },
      ["preferred", "fallback"],
    );

    assertEquals(found, "preferred");
  });

  it("propagates a higher-priority transient failure before a later valid file", async () => {
    const transientFailure = new Error("source snapshot unavailable");
    await assertRejects(
      () =>
        findFirstExistingFile(
          {
            stat(path) {
              return path === "preferred"
                ? Promise.reject(transientFailure)
                : Promise.resolve({ isFile: true });
            },
          },
          ["preferred", "fallback"],
        ),
      Error,
      "source snapshot unavailable",
    );
  });

  it("does not wait for a non-settling lower-priority probe after selecting a preferred file", async () => {
    let releaseFallback!: () => void;
    const fallback = new Promise<void>((resolve) => {
      releaseFallback = resolve;
    });
    const found = await findFirstExistingFile(
      {
        async stat(path) {
          if (path === "fallback") await fallback;
          return { isFile: true };
        },
      },
      ["preferred", "fallback"],
    );

    assertEquals(found, "preferred");
    releaseFallback();
    await fallback;
  });
});
