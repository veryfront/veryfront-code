import "#veryfront/schemas/_test-setup.ts";
import { startTransition, Suspense } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  useWorkflowStart,
  type UseWorkflowStartOptions,
  type UseWorkflowStartResult,
} from "./use-workflow-start.ts";
import {
  deferred,
  installFetch,
  installHookDom,
  ObjectResponse,
  settle,
} from "./workflow-hook-test-utils.test.ts";

function mount(options: UseWorkflowStartOptions) {
  let currentOptions = options;
  let latest: UseWorkflowStartResult<Record<string, unknown>> | null = null;
  const Capture = (): null => {
    latest = useWorkflowStart<Record<string, unknown>>(currentOptions);
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    get: () => latest as UseWorkflowStartResult<Record<string, unknown>>,
    render(next: UseWorkflowStartOptions): void {
      currentOptions = next;
      flushSync(() => root.render(<Capture />));
    },
    unmount(): void {
      flushSync(() => root.unmount());
    },
  };
}

describe("useWorkflowStart", () => {
  it("rejects a malformed successful response instead of returning an empty run id", async () => {
    const restoreDom = installHookDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    const starts: string[] = [];
    try {
      const view = mount({
        workflowId: "workflow-1",
        onStart: (runId) => starts.push(runId),
      });
      const started = view.get().start({ prompt: "hello" });
      request.resolve(new ObjectResponse({}));

      await assertRejects(() => started, Error, "Invalid workflow start response");
      await settle();
      assertEquals(view.get().lastRunId, null);
      assertEquals(starts, []);
      assert(view.get().error instanceof Error);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("encodes workflow identity and prevents an obsolete start from committing", async () => {
    const restoreDom = installHookDom();
    const oldRequest = deferred<Response>();
    const fetch = installFetch([oldRequest]);
    const starts: string[] = [];
    try {
      const view = mount({
        workflowId: "workflow/old",
        onStart: (runId) => starts.push(runId),
      });
      const started = view.get().start({});
      view.render({ workflowId: "workflow/new", onStart: (runId) => starts.push(runId) });

      assertEquals(String(fetch.calls[0]?.input), "/api/workflows/workflow%2Fold/start");
      assertEquals(fetch.calls[0]?.init?.signal?.aborted, true);

      oldRequest.resolve(new ObjectResponse({ runId: "stale-run" }));
      await assertRejects(() => started, Error);
      await settle();
      assertEquals(view.get().lastRunId, null);
      assertEquals(starts, []);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("reports every concurrent success and makes lastRunId follow completion order", async () => {
    const restoreDom = installHookDom();
    const firstRequest = deferred<Response>();
    const secondRequest = deferred<Response>();
    const fetch = installFetch([firstRequest, secondRequest]);
    const starts: string[] = [];
    try {
      const view = mount({
        workflowId: "workflow-1",
        onStart: (runId) => starts.push(runId),
      });
      const first = view.get().start({ request: "first" });
      const second = view.get().start({ request: "second" });

      secondRequest.resolve(new ObjectResponse({ runId: "run-second" }));
      assertEquals(await second, "run-second");
      await settle();
      assertEquals(starts, ["run-second"]);
      assertEquals(view.get().lastRunId, "run-second");
      assertEquals(view.get().isStarting, true);

      firstRequest.resolve(new ObjectResponse({ runId: "run-first" }));
      assertEquals(await first, "run-first");
      await settle();
      assertEquals(starts, ["run-second", "run-first"]);
      assertEquals(view.get().lastRunId, "run-first");
      assertEquals(view.get().isStarting, false);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("keeps a committed start bound to workflow A during an abandoned B render", async () => {
    const restoreDom = installHookDom();
    const request = deferred<Response>();
    const suspended = deferred<void>();
    const fetch = installFetch([request]);
    let options: UseWorkflowStartOptions = { workflowId: "workflow-a" };
    let latest: UseWorkflowStartResult<Record<string, unknown>> | null = null;
    const Capture = (): null => {
      const result = useWorkflowStart<Record<string, unknown>>(options);
      if (options.workflowId === "workflow-b") throw suspended.promise;
      latest = result;
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() =>
        root.render(
          <Suspense fallback={null}>
            <Capture />
          </Suspense>,
        )
      );
      options = { workflowId: "workflow-b" };
      startTransition(() =>
        root.render(
          <Suspense fallback={null}>
            <Capture />
          </Suspense>,
        )
      );
      await settle();

      const started = latest!.start({});
      assertEquals(String(fetch.calls[0]?.input), "/api/workflows/workflow-a/start");
      request.resolve(new ObjectResponse({ runId: "run-a" }));
      assertEquals(await started, "run-a");
    } finally {
      flushSync(() => root.unmount());
      fetch.restore();
      restoreDom();
    }
  });
});
