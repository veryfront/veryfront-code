import "#veryfront/schemas/_test-setup.ts";
import { startTransition, Suspense } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  useWorkflowList,
  type UseWorkflowListOptions,
  type UseWorkflowListResult,
} from "./use-workflow-list.ts";
import {
  deferred,
  installFetch,
  installHookDom,
  ObjectResponse,
  settle,
  workflowRunWire,
} from "./workflow-hook-test-utils.test.ts";

function mount(options: UseWorkflowListOptions) {
  let latest: UseWorkflowListResult | null = null;
  const Capture = (): null => {
    latest = useWorkflowList(options);
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    get: () => latest as UseWorkflowListResult,
    unmount(): void {
      flushSync(() => root.unmount());
    },
  };
}

class FakeIntervals {
  private nextId = 1;
  private callbacks = new Map<number, () => void>();

  readonly setInterval = (handler: TimerHandler): number => {
    if (typeof handler !== "function") throw new Error("tests schedule function callbacks");
    const id = this.nextId++;
    this.callbacks.set(id, () => handler());
    return id;
  };

  readonly clearInterval = (id: number | undefined): void => {
    if (id !== undefined) this.callbacks.delete(id);
  };

  tick(): void {
    for (const callback of [...this.callbacks.values()]) callback();
  }
}

function installIntervals(): { intervals: FakeIntervals; restore: () => void } {
  const intervals = new FakeIntervals();
  const setDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setInterval");
  const clearDescriptor = Object.getOwnPropertyDescriptor(globalThis, "clearInterval");
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    value: intervals.setInterval,
    writable: true,
  });
  Object.defineProperty(globalThis, "clearInterval", {
    configurable: true,
    value: intervals.clearInterval,
    writable: true,
  });
  return {
    intervals,
    restore: () => {
      if (setDescriptor) Object.defineProperty(globalThis, "setInterval", setDescriptor);
      if (clearDescriptor) Object.defineProperty(globalThis, "clearInterval", clearDescriptor);
    },
  };
}

describe("useWorkflowList pagination ownership", () => {
  it("does not refetch when the cursor changes and resets pagination on refresh", async () => {
    const restoreDom = installHookDom();
    const initial = deferred<Response>();
    const nextPage = deferred<Response>();
    const refreshed = deferred<Response>();
    const fetch = installFetch([initial, nextPage, refreshed]);
    let view: ReturnType<typeof mount> | undefined;
    try {
      view = mount({ workflowId: "workflow-1", autoRefresh: false, pageSize: 1 });
      initial.resolve(
        new ObjectResponse({
          runs: [workflowRunWire("run-1")],
          cursor: "next page",
          totalCount: 2,
        }),
      );
      await settle();

      assertEquals(fetch.calls.length, 1);
      assertEquals(view.get().runs.map((run) => run.id), ["run-1"]);
      assertEquals(view.get().hasMore, true);

      const loaded = view.get().loadMore();
      assertStringIncludes(String(fetch.calls[1]?.input), "cursor=next+page");
      nextPage.resolve(new ObjectResponse({ runs: [workflowRunWire("run-2")] }));
      await loaded;
      await settle();
      assertEquals(view.get().runs.map((run) => run.id), ["run-1", "run-2"]);
      assertEquals(view.get().hasMore, false);

      const refresh = view.get().refresh();
      assertEquals(String(fetch.calls[2]?.input).includes("cursor="), false);
      refreshed.resolve(new ObjectResponse({ runs: [workflowRunWire("run-3")] }));
      await refresh;
      await settle();
      assertEquals(view.get().runs.map((run) => run.id), ["run-3"]);
    } finally {
      view?.unmount();
      fetch.restore();
      restoreDom();
    }
  });

  it("aborts stale filters and allows an explicit filter field to be cleared", async () => {
    const restoreDom = installHookDom();
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    const fetch = installFetch([oldRequest, newRequest]);
    let view: ReturnType<typeof mount> | undefined;
    try {
      const mounted = mount({ workflowId: "old", status: "running", autoRefresh: false });
      view = mounted;
      flushSync(() => mounted.get().setFilter({ workflowId: "new", status: undefined }));

      assertEquals(fetch.calls[0]?.init?.signal?.aborted, true);
      assertStringIncludes(String(fetch.calls[1]?.input), "workflowId=new");
      assertEquals(String(fetch.calls[1]?.input).includes("status="), false);

      newRequest.resolve(new ObjectResponse({ runs: [workflowRunWire("new-run")] }));
      await settle();
      oldRequest.resolve(new ObjectResponse({ runs: [workflowRunWire("old-run")] }));
      await settle();
      assertEquals(view.get().runs.map((run) => run.id), ["new-run"]);
    } finally {
      view?.unmount();
      fetch.restore();
      restoreDom();
    }
  });

  it("keeps committed refresh bound to API A during an abandoned API B render", async () => {
    const restoreDom = installHookDom();
    const initial = deferred<Response>();
    const refreshed = deferred<Response>();
    const suspended = deferred<void>();
    const fetch = installFetch([initial, refreshed]);
    let options: UseWorkflowListOptions = { apiBase: "/api-a", autoRefresh: false };
    let latest: UseWorkflowListResult | null = null;
    const Capture = (): null => {
      const result = useWorkflowList(options);
      if (options.apiBase === "/api-b") throw suspended.promise;
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
      initial.resolve(new ObjectResponse({ runs: [] }));
      await settle();

      options = { apiBase: "/api-b", autoRefresh: false };
      startTransition(() =>
        root.render(
          <Suspense fallback={null}>
            <Capture />
          </Suspense>,
        )
      );
      await settle();

      const refresh = latest!.refresh();
      assertEquals(String(fetch.calls[1]?.input).startsWith("/api-a/runs?"), true);
      refreshed.resolve(new ObjectResponse({ runs: [] }));
      await refresh;
    } finally {
      flushSync(() => root.unmount());
      fetch.restore();
      restoreDom();
    }
  });
});

describe("useWorkflowList polling", () => {
  it("serializes automatic refresh while the previous refresh is unresolved", async () => {
    const restoreDom = installHookDom();
    const timer = installIntervals();
    const initial = deferred<Response>();
    const poll = deferred<Response>();
    const unexpected = deferred<Response>();
    const fetch = installFetch([initial, poll, unexpected]);
    let view: ReturnType<typeof mount> | undefined;
    try {
      view = mount({ autoRefresh: true, refreshInterval: 1 });
      initial.resolve(new ObjectResponse({ runs: [workflowRunWire("run-1")] }));
      await settle();

      timer.intervals.tick();
      timer.intervals.tick();
      assertEquals(fetch.calls.length, 2);

      poll.resolve(new ObjectResponse({ runs: [workflowRunWire("run-2")] }));
      await settle();
    } finally {
      view?.unmount();
      fetch.restore();
      timer.restore();
      restoreDom();
    }
  });
});
