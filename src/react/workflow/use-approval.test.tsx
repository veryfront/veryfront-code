import "#veryfront/schemas/_test-setup.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ApprovalDecision } from "#veryfront/workflow/types.ts";
import { useApproval, type UseApprovalOptions, type UseApprovalResult } from "./use-approval.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

class ObjectResponse extends Response {
  constructor(private readonly value: unknown, status = 200) {
    super(null, { status });
  }

  override json(): Promise<unknown> {
    return Promise.resolve(this.value);
  }
}

function approvalWire(id: string, message = id): Record<string, unknown> {
  return {
    id,
    nodeId: "node-1",
    message,
    payload: { nested: { value: message } },
    approvers: ["editor@example.test"],
    requestedAt: "2026-07-31T10:00:00.000Z",
    expiresAt: "2026-08-01T10:00:00.000Z",
    status: "pending",
  };
}

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.test/",
  });
  const replacements: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    self: dom.window,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of Object.keys(replacements)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: replacements[key],
      writable: true,
    });
  }
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

function installFetch(queue: Deferred<Response>[]) {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const fetchMock = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ input, init });
    const next = queue.shift();
    if (!next) throw new Error("Unexpected fetch call");
    return next.promise;
  };
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
  return {
    calls,
    restore(): void {
      if (previous) Object.defineProperty(globalThis, "fetch", previous);
      else delete (globalThis as Record<string, unknown>).fetch;
    },
  };
}

function mount(options: UseApprovalOptions) {
  let currentOptions = options;
  let latest: UseApprovalResult | null = null;
  const Capture = (): null => {
    latest = useApproval(currentOptions);
    return null;
  };
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Capture />));
  return {
    get: () => latest as UseApprovalResult,
    render(next: UseApprovalOptions): void {
      currentOptions = next;
      flushSync(() => root.render(<Capture />));
    },
    unmount(): void {
      flushSync(() => root.unmount());
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

describe("useApproval request ownership", () => {
  it("does not report loading or failed requests as resolved", async () => {
    const restoreDom = installDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    try {
      const view = mount({ runId: "run-1", approvalId: "approval-1" });
      assertEquals(view.get().isLoading, true);
      assertEquals(view.get().isPending, false);
      assertEquals(view.get().isResolved, false);

      request.resolve(new ObjectResponse({}, 200));
      await settle();
      assertEquals(view.get().isLoading, false);
      assertEquals(view.get().isResolved, false);
      assert(view.get().error instanceof Error);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("encodes path identities, aborts obsolete work, and fences stale completion", async () => {
    const restoreDom = installDom();
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    const fetch = installFetch([oldRequest, newRequest]);
    try {
      const view = mount({ runId: "run/old", approvalId: "approval old" });
      view.render({ runId: "run/new", approvalId: "approval new" });

      assertEquals(
        String(fetch.calls[0]?.input),
        "/api/workflows/runs/run%2Fold/approvals/approval%20old",
      );
      assertEquals(fetch.calls[0]?.init?.signal?.aborted, true);

      newRequest.resolve(new ObjectResponse(approvalWire("approval new", "current")));
      await settle();
      assertEquals(view.get().approval?.message, "current");

      oldRequest.resolve(new ObjectResponse(approvalWire("approval old", "stale")));
      await settle();
      assertEquals(view.get().approval?.message, "current");
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("does not refetch when only callback identity changes", async () => {
    const restoreDom = installDom();
    const request = deferred<Response>();
    const unexpected = deferred<Response>();
    const fetch = installFetch([request, unexpected]);
    try {
      const view = mount({
        runId: "run-1",
        approvalId: "approval-1",
        onError: () => undefined,
      });
      request.resolve(new ObjectResponse(approvalWire("approval-1")));
      await settle();

      view.render({
        runId: "run-1",
        approvalId: "approval-1",
        onError: () => undefined,
      });
      await settle();
      assertEquals(fetch.calls.length, 1);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("rejects a canonical approval response for a different approval identity", async () => {
    const restoreDom = installDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    try {
      const view = mount({ runId: "run-1", approvalId: "approval-a" });
      request.resolve(new ObjectResponse(approvalWire("approval-b")));
      await settle();

      assertEquals(view.get().approval, null);
      assert(view.get().error instanceof Error);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });
});

describe("useApproval wire admission", () => {
  it("validates, revives documented dates, and snapshots nested user payload", async () => {
    const restoreDom = installDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    const wire = approvalWire("approval-1", "review");
    try {
      const view = mount({ runId: "run-1", approvalId: "approval-1" });
      request.resolve(new ObjectResponse(wire));
      await settle();

      const approval = view.get().approval;
      assert(approval?.requestedAt instanceof Date);
      assert(approval?.expiresAt instanceof Date);
      assertEquals(approval?.payload, { nested: { value: "review" } });

      const payload = wire.payload;
      assert(payload && typeof payload === "object");
      Object.assign(payload, { nested: { value: "mutated" } });
      (wire.approvers as string[]).push("mutated@example.test");
      assertEquals(view.get().approval?.payload, { nested: { value: "review" } });
      assertEquals(view.get().approval?.approvers, ["editor@example.test"]);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("rejects malformed successful responses without exposing partial state", async () => {
    const restoreDom = installDom();
    const request = deferred<Response>();
    const fetch = installFetch([request]);
    const reported: Error[] = [];
    try {
      const view = mount({
        runId: "run-1",
        approvalId: "approval-1",
        onError: (error) => reported.push(error),
      });
      request.resolve(new ObjectResponse({ id: "approval-1", status: "pending" }));
      await settle();

      assertEquals(view.get().approval, null);
      assert(view.get().error instanceof Error);
      assertEquals(view.get().isLoading, false);
      assertEquals(view.get().isResolved, false);
      assertEquals(reported.length, 1);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });
});

describe("useApproval decision state", () => {
  it("aborts and fences the initial read before submitting so it cannot hang or win", async () => {
    const restoreDom = installDom();
    const load = deferred<Response>();
    const submit = deferred<Response>();
    const reconcile = deferred<Response>();
    const fetch = installFetch([load, submit, reconcile]);
    try {
      const view = mount({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "editor@example.test",
      });

      const submitted = view.get().approve("approved");
      await settle();
      assertEquals(fetch.calls.length, 2);
      assertEquals(fetch.calls[0]?.init?.signal?.aborted, true);
      assertEquals(fetch.calls[1]?.init?.method, "POST");

      submit.resolve(new ObjectResponse({ ok: true }));
      await settle();
      const decided = approvalWire("approval-1");
      decided.status = "approved";
      reconcile.resolve(new ObjectResponse(decided));
      await submitted;
      load.resolve(new ObjectResponse(approvalWire("approval-1")));
      await settle();
      assertEquals(view.get().approval?.status, "approved");
      assertEquals(view.get().isResolved, true);
      assertEquals(view.get().isLoading, false);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("serializes concurrent decisions and reports every accepted server decision", async () => {
    const restoreDom = installDom();
    const load = deferred<Response>();
    const approveRequest = deferred<Response>();
    const rejectRequest = deferred<Response>();
    const fetch = installFetch([load, approveRequest, rejectRequest]);
    const accepted: ApprovalDecision[] = [];
    try {
      const view = mount({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "editor@example.test",
        onDecision: (decision) => accepted.push(decision),
      });
      load.resolve(new ObjectResponse(approvalWire("approval-1")));
      await settle();

      const approved = view.get().approve("first");
      const rejected = view.get().reject("second");
      await settle();
      assertEquals(fetch.calls.length, 2);
      assertEquals(fetch.calls[1]?.init?.signal?.aborted, false);

      approveRequest.resolve(new ObjectResponse({ ok: true }));
      await approved;
      await settle();
      assertEquals(fetch.calls.length, 3);
      assertEquals(view.get().isSubmitting, true);

      rejectRequest.resolve(new ObjectResponse({ ok: true }));
      await rejected;
      await settle();
      assertEquals(accepted.map((decision) => decision.comment), ["first", "second"]);
      assertEquals(view.get().approval?.status, "rejected");
      assertEquals(view.get().isSubmitting, false);
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("rejects an in-flight decision whose committed identity is replaced", async () => {
    const restoreDom = installDom();
    const loadA = deferred<Response>();
    const submitA = deferred<Response>();
    const loadB = deferred<Response>();
    const fetch = installFetch([loadA, submitA, loadB]);
    try {
      const view = mount({ runId: "run-a", approvalId: "approval-a" });
      loadA.resolve(new ObjectResponse(approvalWire("approval-a")));
      await settle();

      const submitted = view.get().approve();
      await settle();
      const rejected = assertRejects(() => submitted);
      view.render({ runId: "run-b", approvalId: "approval-b" });
      assertEquals(fetch.calls[1]?.init?.signal?.aborted, true);

      submitA.resolve(new ObjectResponse({ ok: true }));
      const rejection = await rejected;
      assert(rejection instanceof Error);
      assertEquals(rejection.name, "AbortError");

      loadB.resolve(new ObjectResponse(approvalWire("approval-b")));
      await settle();
      assertEquals(view.get().approval?.id, "approval-b");
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("records documented decision fields after an accepted submission", async () => {
    const restoreDom = installDom();
    const load = deferred<Response>();
    const submit = deferred<Response>();
    const fetch = installFetch([load, submit]);
    try {
      const view = mount({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "editor@example.test",
      });
      load.resolve(new ObjectResponse(approvalWire("approval-1")));
      await settle();

      const submitted = view.get().approve("approved");
      submit.resolve(new ObjectResponse({ ok: true }));
      await submitted;
      await settle();

      assertEquals(view.get().approval?.status, "approved");
      assertEquals(view.get().approval?.decidedBy, "editor@example.test");
      assert(view.get().approval?.decidedAt instanceof Date);
      assertEquals(view.get().approval?.comment, "approved");
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });

  it("does not reject an accepted decision solely because reconciliation fails", async () => {
    const restoreDom = installDom();
    const load = deferred<Response>();
    const submit = deferred<Response>();
    const reconcile = deferred<Response>();
    const fetch = installFetch([load, submit, reconcile]);
    const accepted: ApprovalDecision[] = [];
    try {
      const view = mount({
        runId: "run-1",
        approvalId: "approval-1",
        onDecision: (decision) => accepted.push(decision),
      });
      const submitted = view.get().approve("accepted");
      await settle();
      submit.resolve(new ObjectResponse({ ok: true }));
      await settle();
      reconcile.resolve(new ObjectResponse({}, 500));

      await submitted;
      await settle();
      assertEquals(accepted.map((decision) => decision.comment), ["accepted"]);
      assert(view.get().error instanceof Error);
      assertEquals(view.get().approval, null);
      load.resolve(new ObjectResponse(approvalWire("approval-1")));
      view.unmount();
    } finally {
      fetch.restore();
      restoreDom();
    }
  });
});
