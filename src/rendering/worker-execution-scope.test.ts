import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { WorkerExecutionScopeOwner } from "./worker-execution-scope.ts";

describe("WorkerExecutionScopeOwner", () => {
  it("keeps active pipelines on the old scope while fresh pipelines use the replacement", () => {
    const evicted: string[] = [];
    let generated = 0;
    const owner = new WorkerExecutionScopeOwner({
      createScopeId: () => `scope-${++generated}`,
      evictScope: (scopeId) => evicted.push(scopeId),
    });

    const firstOldPipeline = owner.acquire();
    const secondOldPipeline = owner.acquire();
    const oldScopeId = firstOldPipeline.scopeId;

    const replacementScopeId = owner.rotate();
    const freshPipeline = owner.acquire();

    assertEquals(secondOldPipeline.scopeId, oldScopeId);
    assertEquals(freshPipeline.scopeId, replacementScopeId);
    assertNotEquals(replacementScopeId, oldScopeId);
    assertEquals(evicted, []);

    firstOldPipeline.release();
    assertEquals(evicted, []);
    secondOldPipeline.release();
    assertEquals(evicted, [oldScopeId]);

    freshPipeline.release();
    assertEquals(evicted, [oldScopeId]);
    owner.close(true);
    assertEquals(evicted, [oldScopeId, replacementScopeId]);
  });

  it("snapshots one generated scope until an explicit rotation", () => {
    let generated = 0;
    const owner = new WorkerExecutionScopeOwner({
      createScopeId: () => `scope-${++generated}`,
      evictScope: () => {},
    });

    const first = owner.acquire();
    const second = owner.acquire();
    assertEquals(generated, 1);
    assertEquals(first.scopeId, second.scopeId);

    owner.rotate();
    const third = owner.acquire();
    assertEquals(generated, 2);
    assertNotEquals(third.scopeId, first.scopeId);

    first.release();
    second.release();
    third.release();
    owner.close(true);
  });

  it("rejects unsafe same-ID rotation and new leases after closure", () => {
    const owner = new WorkerExecutionScopeOwner({
      initialScopeId: "scope-owned-externally",
      evictScope: () => {},
    });

    assertThrows(
      () => owner.rotate("scope-owned-externally"),
      TypeError,
      "requires a different scope ID",
    );

    owner.close(false);
    assertThrows(
      () => owner.acquire(),
      Error,
      "has been closed",
    );
    assertThrows(
      () => owner.rotate("replacement"),
      Error,
      "has been closed",
    );
  });
});
