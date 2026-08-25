import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetDependencySnapshotRecoveryForTests,
  recoverFromDependencySnapshotConflict,
  recoverFromSnapshotBoundModuleFailure,
} from "./dependency-snapshot-recovery.ts";

describe("rendering/rsc/dependency-snapshot-recovery", () => {
  afterEach(() => {
    __resetDependencySnapshotRecoveryForTests();
  });

  it("reloads once for an explicit unknown dependency snapshot response", async () => {
    let reloads = 0;
    const reload = () => {
      reloads++;
    };

    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Unknown dependency snapshot", { status: 409 }),
        reload,
      ),
      true,
    );
    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Unknown dependency snapshot", { status: 409 }),
        reload,
      ),
      true,
    );
    assertEquals(reloads, 1);
  });

  it("releases the one-shot marker when the reload is blocked", async () => {
    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Unknown dependency snapshot", { status: 409 }),
        () => {
          throw new Error("blocked");
        },
      ),
      false,
      "a blocked reload reports no recovery",
    );

    let reloads = 0;
    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Unknown dependency snapshot", { status: 409 }),
        () => {
          reloads++;
        },
      ),
      true,
      "recovery is retried after a blocked reload",
    );
    assertEquals(reloads, 1, "the marker was released so the retry actually reloads");
  });

  it("recognizes the exact dev fs JavaScript conflict module", async () => {
    let reloads = 0;

    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("export default null; // Unknown dependency snapshot", {
          status: 409,
          headers: { "content-type": "application/javascript" },
        }),
        () => {
          reloads++;
        },
      ),
      true,
    );
    assertEquals(reloads, 1);
  });

  it("shares its one-shot marker with the production hydration renderer", async () => {
    const recoveryGlobal = globalThis as typeof globalThis & {
      __VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__?: boolean;
    };
    recoveryGlobal.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__ = true;
    let reloads = 0;

    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Unknown dependency snapshot", { status: 409 }),
        () => {
          reloads++;
        },
      ),
      true,
    );
    assertEquals(reloads, 0);
  });

  it("does not reload for unrelated failures or arbitrary conflicts", async () => {
    let reloads = 0;
    const reload = () => {
      reloads++;
    };

    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Unknown dependency snapshot", { status: 500 }),
        reload,
      ),
      false,
    );
    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response("Application conflict", { status: 409 }),
        reload,
      ),
      false,
    );
    assertEquals(
      await recoverFromDependencySnapshotConflict(
        new Response(
          "export default null; // Unknown dependency snapshot: application conflict",
          { status: 409 },
        ),
        reload,
      ),
      false,
    );
    assertEquals(reloads, 0);
  });

  it("probes a failed snapshot-bound module and reloads only for its explicit conflict", async () => {
    const requestedUrls: string[] = [];
    const cacheModes: (RequestCache | undefined)[] = [];
    let reloads = 0;
    const fetchModule: typeof fetch = (input, init) => {
      requestedUrls.push(String(input));
      cacheModes.push((init as { cache?: RequestCache } | undefined)?.cache);
      return Promise.resolve(
        new Response("Unknown dependency snapshot", { status: 409 }),
      );
    };

    assertEquals(
      await recoverFromSnapshotBoundModuleFailure(
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
        fetchModule,
        () => {
          reloads++;
        },
      ),
      true,
    );
    assertEquals(requestedUrls, [
      "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
    ]);
    assertEquals(cacheModes, ["no-store"]);
    assertEquals(reloads, 1);
  });

  it("does not probe unpinned modules or reload for unrelated module failures", async () => {
    let fetches = 0;
    let reloads = 0;
    const fetchModule: typeof fetch = () => {
      fetches++;
      return Promise.resolve(new Response("Application conflict", { status: 409 }));
    };

    assertEquals(
      await recoverFromSnapshotBoundModuleFailure(
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx",
        fetchModule,
        () => {
          reloads++;
        },
      ),
      false,
    );
    assertEquals(
      await recoverFromSnapshotBoundModuleFailure(
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
        fetchModule,
        () => {
          reloads++;
        },
      ),
      false,
    );
    assertEquals(fetches, 1);
    assertEquals(reloads, 0);
  });
});
