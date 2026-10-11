import {
  createRuntimeOwnershipChildProbe,
  type OwnershipChildClient,
} from "./project-run-runtime-ownership-child-probe.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
const NativeError = Error;
function fixture() {
  let reject = true, changed = false;
  const attempts: Array<{ path: string; wire: string; key?: string }> = [];
  const client: OwnershipChildClient = {
    get: <T>() =>
      Promise.resolve(
        {
          id: "parent",
          project_id: "project",
          descendant_count: changed ? 1 : 0,
          active_descendant_count: changed ? 1 : 0,
          status: "cancelled",
        } as T,
      ),
    post: <T>() => Promise.resolve({ appended_count: 1 } as T),
    postRaw: <T>(
      path: string,
      wire: string,
      options?: { signal?: AbortSignal; idempotencyKey?: string },
    ) => {
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
    client,
    accept: () => {
      reject = false;
    },
    change: () => {
      changed = true;
    },
  };
}
describe("host-owned child admission after cancellation", () => {
  it("prepares current STEP_STARTED then directly attempts supported POST /runs with a stable key", async () => {
    const f = fixture();
    const prepared = await f.probe({ ...f.request, staleAfterCancel: false });
    assertEquals(f.attempts.length, 0);
    const denied = await f.probe({ ...f.request, staleAfterCancel: true });
    assertEquals(denied.authorizationDenied, true);
    assertEquals(prepared.requestHash, denied.requestHash);
    assertEquals(denied.runBeforeHash, denied.runAfterHash);
    assertEquals(f.attempts[0]!.path, "/runs");
    assertEquals(f.attempts[0]!.key?.startsWith("task-child:"), true);
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
