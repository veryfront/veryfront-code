import {
  createRuntimeOwnershipChildProbe,
  type OwnershipChildClient,
} from "./project-run-runtime-ownership-child-probe.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
const NativeError = Error;
function fixture() {
  let reject = true,
    changed = false,
    useLegacyLineage = false,
    omitDescendants = false,
    volatile = 0;
  const attempts: Array<{ path: string; wire: string; key?: string }> = [];
  const eventAttempts: Array<{ path: string; wire: string; key?: string }> = [];
  const client: OwnershipChildClient = {
    get: <T>() =>
      Promise.resolve(
        {
          id: "parent",
          project_id: "project",
          ...(useLegacyLineage
            ? { descendant_count: changed ? 1 : 0, active_descendant_count: changed ? 1 : 0 }
            : omitDescendants
            ? {}
            : {
              descendants: {
                total: changed ? 1 : 0,
                active: changed ? 1 : 0,
                has_failures: false,
              },
            }),
          status: "cancelled",
          updated_at: `2026-10-12T22:59:0${volatile}.000Z`,
        } as T,
      ),
    post: <T>() => Promise.resolve({ appended_count: 1 } as T),
    postRaw: <T>(
      path: string,
      wire: string,
      options?: { signal?: AbortSignal; idempotencyKey?: string },
    ) => {
      if (path.endsWith("/events")) {
        eventAttempts.push({ path, wire, key: options?.idempotencyKey });
        return Promise.resolve({ appended_count: 1 } as T);
      }
      attempts.push({ path, wire, key: options?.idempotencyKey });
      return reject
        ? Promise.reject(new NativeError("Veryfront API request failed: 403 Forbidden"))
        : Promise.resolve({ id: "unexpected-child" } as T);
    },
  };
  const probe = createRuntimeOwnershipChildProbe({
    projectId: "project",
    canonicalRunId: "parent",
    targetTaskId: "ce-runtime-proof-task",
    createWriter: () => client,
    createReader: () => client,
    createEvents: () => client,
  });
  const request = { sourcePath: "knowledge/owned/parent.md", signal: new AbortController().signal };
  return {
    probe,
    request,
    attempts,
    eventAttempts,
    client,
    accept: () => {
      reject = false;
    },
    change: () => {
      changed = true;
    },
    changeVolatileReadback: () => {
      volatile += 1;
    },
    omitDescendants: () => {
      omitDescendants = true;
    },
    useLegacyLineage: () => {
      useLegacyLineage = true;
    },
  };
}
describe("host-owned child admission after cancellation", () => {
  it("prepares current STEP_STARTED then directly attempts supported POST /runs with a stable key", async () => {
    const f = fixture();
    const prepared = await f.probe({ ...f.request, staleAfterCancel: false });
    assertEquals(f.attempts.length, 0);
    assertEquals(f.eventAttempts[0]!.path, "/runs/parent/events");
    assertEquals(f.eventAttempts[0]!.key?.startsWith("task-child-start:"), true);
    const denied = await f.probe({ ...f.request, staleAfterCancel: true });
    assertEquals(denied.authorizationDenied, true);
    assertEquals(prepared.requestHash, denied.requestHash);
    assertEquals(denied.runBeforeHash, denied.runAfterHash);
    assertEquals(f.attempts[0]!.path, "/runs");
    assertEquals(f.attempts[0]!.key?.startsWith("task-child:"), true);
    assertEquals(JSON.parse(f.eventAttempts[0]!.wire), {
      events: [{ type: "STEP_STARTED", stepId: f.attempts[0]!.key }],
    });
    assertEquals(JSON.parse(f.attempts[0]!.wire), {
      project_id: "project",
      parent_run_id: "parent",
      target: { type: "task", id: "ce-runtime-proof-task" },
      input: { runtimeOwnershipChildProbe: true },
    });
  });
  it("fails a successful admission even when parent readback stays unchanged", async () => {
    const f = fixture();
    await f.probe({ ...f.request, staleAfterCancel: false });
    f.accept();
    await assertRejects(
      () => f.probe({ ...f.request, staleAfterCancel: true }),
      NativeError,
      "accepted after cancellation",
    );
  });
  it("refuses to exercise admission without a current acknowledged invocation", async () => {
    const f = fixture();
    await assertRejects(
      () => f.probe({ ...f.request, staleAfterCancel: true }),
      NativeError,
      "No current owned child invocation receipt",
    );
    assertEquals(f.attempts.length, 0);
  });
  it("rejects legacy top-level descendant counters instead of treating them as canonical readback", async () => {
    const f = fixture();
    await f.probe({ ...f.request, staleAfterCancel: false });
    f.useLegacyLineage();
    await assertRejects(
      () => f.probe({ ...f.request, staleAfterCancel: true }),
      NativeError,
      "Child lineage readback is incomplete",
    );
    assertEquals(f.attempts.length, 0);
  });
  it("accepts canonical zero-descendant parent readback when descendants is omitted", async () => {
    const f = fixture();
    await f.probe({ ...f.request, staleAfterCancel: false });
    f.omitDescendants();
    const denied = await f.probe({ ...f.request, staleAfterCancel: true });
    assertEquals(denied.authorizationDenied, true);
  });
  it("ignores volatile parent readback fields outside identity, status, and lineage", async () => {
    const f = fixture();
    await f.probe({ ...f.request, staleAfterCancel: false });
    const original = f.client.postRaw;
    f.client.postRaw = (path, wire, options) => {
      f.changeVolatileReadback();
      return original(path, wire, options);
    };
    const denied = await f.probe({ ...f.request, staleAfterCancel: true });
    assertEquals(denied.authorizationDenied, true);
    assertEquals(denied.runBeforeHash, denied.runAfterHash);
  });
  it("does not substitute bad request or transport failure for authority denial", async () => {
    const f = fixture();
    await f.probe({ ...f.request, staleAfterCancel: false });
    f.client.postRaw = () => Promise.reject(new NativeError("400 Bad Request"));
    await assertRejects(
      () => f.probe({ ...f.request, staleAfterCancel: true }),
      NativeError,
      "without authorization denial",
    );
  });
  it("fails if a denied request changes parent lineage", async () => {
    const f = fixture();
    await f.probe({ ...f.request, staleAfterCancel: false });
    const original = f.client.postRaw;
    f.client.postRaw = (path, wire, options) => {
      f.change();
      return original(path, wire, options);
    };
    await assertRejects(
      () => f.probe({ ...f.request, staleAfterCancel: true }),
      NativeError,
      "changed parent state or lineage",
    );
  });
});
