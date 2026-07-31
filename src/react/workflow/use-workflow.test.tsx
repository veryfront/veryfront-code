import "#veryfront/schemas/_test-setup.ts";
import { startTransition, Suspense, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useWorkflow, type UseWorkflowOptions, type UseWorkflowResult } from "./use-workflow.ts";
import {
  deferred,
  installFetch,
  installHookDom,
  ObjectResponse,
  settle,
  workflowRunWire,
} from "./workflow-hook-test-utils.test.ts";

function mount(options: UseWorkflowOptions) {
  let currentOptions = options;
  let latest: UseWorkflowResult | null = null;
  const Capture = (): null => {
    latest = useWorkflow(currentOptions);
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    get: () => latest as UseWorkflowResult,
    render(next: UseWorkflowOptions): void {
      currentOptions = next;
      flushSync(() => root.render(<Capture />));
    },
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

describe("useWorkflow response ownership", () => {
  it("rejects malformed successful responses and keeps run state empty", async () => {
    const restoreDom = installHookDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    const reported: Error[] = [];
    try {
      const view = mount({
        runId: "run-1",
        autoRefresh: false,
        onError: (error) => reported.push(error),
      });
      request.resolve(new ObjectResponse({ id: "run-1", status: "running" }));
      await settle();

      assertEquals(view.get().run, null);
      assert(view.get().error instanceof Error);
      assertEquals(reported.length, 1);
      assertEquals(view.get().isLoading, false);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("does not expose durable tenant credentials from a miswired route", async () => {
    const restoreDom = installHookDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    const durableRun = workflowRunWire("run-1");
    durableRun._tenant = {
      projectSlug: "secret-project",
      token: "secret-token",
      productionMode: true,
    };
    try {
      const view = mount({ runId: "run-1", autoRefresh: false });
      request.resolve(new ObjectResponse(durableRun));
      await settle();

      assertEquals(view.get().run, null);
      assert(view.get().error instanceof Error);
      assertEquals(JSON.stringify(view.get()).includes("secret-token"), false);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("rejects a canonical run response for a different requested run identity", async () => {
    const restoreDom = installHookDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    try {
      const view = mount({ runId: "run-a", autoRefresh: false });
      request.resolve(new ObjectResponse(workflowRunWire("run-b", "running")));
      await settle();

      assertEquals(view.get().run, null);
      assert(view.get().error instanceof Error);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("encodes run identity, aborts stale fetches, and resets transition ownership", async () => {
    const restoreDom = installHookDom();
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    const fetch = installFetch([oldRequest, newRequest]);
    const transitions: Array<[string, string]> = [];
    try {
      const options = {
        autoRefresh: false,
        onStatusChange: (next: string, previous: string) => transitions.push([next, previous]),
      };
      const view = mount({ ...options, runId: "run/old" });
      view.render({ ...options, runId: "run/new" });

      assertEquals(String(fetch.calls[0]?.input), "/api/workflows/runs/run%2Fold");
      assertEquals(fetch.calls[0]?.init?.signal?.aborted, true);

      newRequest.resolve(new ObjectResponse(workflowRunWire("run/new", "pending")));
      await settle();
      oldRequest.resolve(new ObjectResponse(workflowRunWire("run/old", "running")));
      await settle();

      assertEquals(view.get().run?.id, "run/new");
      assertEquals(transitions, []);
      assert(view.get().run?.createdAt instanceof Date);
      assert(view.get().nodeStates["node-1"]?.startedAt instanceof Date);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("keeps committed actions bound to run A when a run B render is abandoned", async () => {
    const restoreDom = installHookDom();
    const initial = deferred<Response>();
    const cancelRequest = deferred<Response>();
    const refreshRequest = deferred<Response>();
    const suspended = deferred<void>();
    const fetch = installFetch([initial, cancelRequest, refreshRequest]);
    let currentOptions: UseWorkflowOptions = { runId: "run-a", autoRefresh: false };
    let latest: UseWorkflowResult | null = null;
    const Capture = (): null => {
      const result = useWorkflow(currentOptions);
      if (currentOptions.runId === "run-b") throw suspended.promise;
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
      initial.resolve(new ObjectResponse(workflowRunWire("run-a", "running")));
      await settle();

      currentOptions = { runId: "run-b", autoRefresh: false };
      startTransition(() =>
        root.render(
          <Suspense fallback={null}>
            <Capture />
          </Suspense>,
        )
      );
      await settle();

      const cancelled = latest!.cancel();
      await settle();
      assertEquals(String(fetch.calls[1]?.input), "/api/workflows/runs/run-a/cancel");
      cancelRequest.resolve(new ObjectResponse({ ok: true }));
      await settle();
      assertEquals(String(fetch.calls[2]?.input), "/api/workflows/runs/run-a");
      refreshRequest.resolve(new ObjectResponse(workflowRunWire("run-a", "cancelled")));
      await cancelled;
    } finally {
      flushSync(() => root.unmount());
      fetch.restore();
      restoreDom();
    }
  });

  it("does not target run A from run B UI before passive identity effects", async () => {
    const restoreDom = installHookDom();
    const initial = deferred<Response>();
    const loadB = deferred<Response>();
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const previousFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ input, init });
        if (init?.method === "POST") return Promise.resolve(new ObjectResponse({ ok: true }));
        return String(input).endsWith("run-a") ? initial.promise : loadB.promise;
      },
    });
    let options: UseWorkflowOptions = { runId: "run-a", autoRefresh: false };
    let layoutAction: Promise<void> | undefined;
    const Capture = (): null => {
      const result = useWorkflow(options);
      useLayoutEffect(() => {
        if (options.runId === "run-b") {
          layoutAction = result.cancel();
          void layoutAction.catch(() => undefined);
        }
      }, [options.runId, result.cancel]);
      return null;
    };
    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      initial.resolve(new ObjectResponse(workflowRunWire("run-a", "running")));
      await settle();

      options = { runId: "run-b", autoRefresh: false };
      flushSync(() => root.render(<Capture />));
      assertEquals(calls.some((call) => call.init?.method === "POST"), false);

      loadB.resolve(new ObjectResponse(workflowRunWire("run-b", "running")));
      await layoutAction?.catch(() => undefined);
      await settle();
    } finally {
      flushSync(() => root.unmount());
      if (previousFetch) Object.defineProperty(globalThis, "fetch", previousFetch);
      else delete (globalThis as Record<string, unknown>).fetch;
      restoreDom();
    }
  });

  it("rejects an action whose committed run identity is replaced", async () => {
    const restoreDom = installHookDom();
    const loadA = deferred<Response>();
    const cancelA = deferred<Response>();
    const loadB = deferred<Response>();
    const fetch = installFetch([loadA, cancelA, loadB]);
    try {
      const view = mount({ runId: "run-a", autoRefresh: false });
      loadA.resolve(new ObjectResponse(workflowRunWire("run-a", "running")));
      await settle();

      const cancelled = view.get().cancel();
      await settle();
      const rejected = assertRejects(() => cancelled);
      view.render({ runId: "run-b", autoRefresh: false });
      assertEquals(fetch.calls[1]?.init?.signal?.aborted, true);
      cancelA.resolve(new ObjectResponse({ ok: true }));
      const rejection = await rejected;
      assert(rejection instanceof Error);
      assertEquals(rejection.name, "AbortError");

      loadB.resolve(new ObjectResponse(workflowRunWire("run-b", "running")));
      await settle();
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });
});

describe("useWorkflow polling", () => {
  it("retries polling after the initial response is malformed", async () => {
    const restoreDom = installHookDom();
    const timer = installIntervals();
    const initial = deferred<Response>();
    const retry = deferred<Response>();
    const fetch = installFetch([initial, retry]);
    try {
      const view = mount({ runId: "run-1", autoRefresh: true, pollInterval: 1 });
      initial.resolve(new ObjectResponse({ id: "run-1", status: "running" }));
      await settle();
      assert(view.get().error instanceof Error);

      timer.intervals.tick();
      assertEquals(fetch.calls.length, 2);
      retry.resolve(new ObjectResponse(workflowRunWire("run-1", "running")));
      await settle();
      assertEquals(view.get().run?.id, "run-1");
      assertEquals(view.get().error, null);
      view.unmount();
    } finally {
      fetch.restore();
      timer.restore();
      restoreDom();
    }
  });

  it("serializes interval polling while a prior poll is unresolved", async () => {
    const restoreDom = installHookDom();
    const timer = installIntervals();
    const initial = deferred<Response>();
    const poll = deferred<Response>();
    const unexpected = deferred<Response>();
    const fetch = installFetch([initial, poll, unexpected]);
    try {
      const view = mount({ runId: "run-1", autoRefresh: true, pollInterval: 1 });
      initial.resolve(new ObjectResponse(workflowRunWire("run-1", "running")));
      await settle();

      timer.intervals.tick();
      timer.intervals.tick();
      assertEquals(fetch.calls.length, 2);

      poll.resolve(new ObjectResponse(workflowRunWire("run-1", "running")));
      await settle();
      view.unmount();
    } finally {
      fetch.restore();
      timer.restore();
      restoreDom();
    }
  });

  it("resumes polling after retry moves a terminal run back to running", async () => {
    const restoreDom = installHookDom();
    const timer = installIntervals();
    const initial = deferred<Response>();
    const retryRequest = deferred<Response>();
    const retryRefresh = deferred<Response>();
    const nextPoll = deferred<Response>();
    const fetch = installFetch([initial, retryRequest, retryRefresh, nextPoll]);
    try {
      const view = mount({ runId: "run-1", autoRefresh: true, pollInterval: 1 });
      initial.resolve(new ObjectResponse(workflowRunWire("run-1", "failed")));
      await settle();

      timer.intervals.tick();
      assertEquals(fetch.calls.length, 1);

      const retried = view.get().retry();
      retryRequest.resolve(new ObjectResponse({ ok: true }));
      await settle();
      retryRefresh.resolve(new ObjectResponse(workflowRunWire("run-1", "running")));
      await retried;
      await settle();

      timer.intervals.tick();
      assertEquals(fetch.calls.length, 4);
      nextPoll.resolve(new ObjectResponse(workflowRunWire("run-1", "running")));
      await settle();
      view.unmount();
    } finally {
      fetch.restore();
      timer.restore();
      restoreDom();
    }
  });
});
