import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { useApproval, type UseApprovalResult } from "./use-approval.ts";
import { useWorkflow, type UseWorkflowOptions, type UseWorkflowResult } from "./use-workflow.ts";
import { useWorkflowList, type UseWorkflowListResult } from "./use-workflow-list.ts";
import { useWorkflowStart, type UseWorkflowStartResult } from "./use-workflow-start.ts";

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.test/",
  });
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
  ] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value: dom.window[key],
      writable: true,
    });
  }

  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as unknown as Record<string, unknown>)[key];
    }
    dom.window.close();
  };
}

describe("useWorkflowStart", () => {
  afterEach(restoreMockFetch);

  it("keeps a start launched from a layout effect current on mount", async () => {
    const restoreDom = installDom();
    const response = Promise.withResolvers<Response>();
    const startedRunIds: string[] = [];
    const onStart = (runId: string): void => {
      startedRunIds.push(runId);
    };
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;
    let startPromise: Promise<string> | null = null;

    installMockFetch((() => response.promise) as typeof fetch);

    function Capture(): null {
      hook = useWorkflowStart({
        workflowId: "workflow-1",
        onStart,
      });
      const start = hook.start;
      useLayoutEffect(() => {
        startPromise = start({});
      }, [start]);
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      assertEquals(hook!.isStarting, true);

      response.resolve(Response.json({ runId: "layout-run" }));
      assertEquals(await startPromise, "layout-run");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isStarting, false);
      assertEquals(hook!.lastRunId, "layout-run");
      assertEquals(startedRunIds, ["layout-run"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("keeps concurrent starts in the same request context independent", async () => {
    const restoreDom = installDom();
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    const responses = [firstResponse, secondResponse];
    const startedRunIds: string[] = [];
    let requestCount = 0;
    let hook: UseWorkflowStartResult<{ order: number }> | null = null;

    installMockFetch(
      (() => responses[requestCount++]!.promise) as typeof fetch,
    );

    function Capture(): null {
      hook = useWorkflowStart({
        workflowId: "workflow-1",
        onStart: (runId) => startedRunIds.push(runId),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      const firstStart = hook!.start({ order: 1 });
      const secondStart = hook!.start({ order: 2 });
      assertEquals(requestCount, 2);

      firstResponse.resolve(Response.json({ runId: "run-first" }));
      assertEquals(await firstStart, "run-first");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isStarting, true, "the second start is still in flight");
      assertEquals(hook!.lastRunId, "run-first");
      assertEquals(startedRunIds, ["run-first"]);

      secondResponse.resolve(Response.json({ runId: "run-second" }));
      assertEquals(await secondStart, "run-second");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isStarting, false);
      assertEquals(hook!.lastRunId, "run-second");
      assertEquals(startedRunIds, ["run-first", "run-second"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("keeps an approval decision launched from a layout effect current on mount", async () => {
    const restoreDom = installDom();
    const decisionResponse = Promise.withResolvers<Response>();
    const decisions: string[] = [];
    const onDecision = (decision: { approver: string }): void => {
      decisions.push(decision.approver);
    };
    let hook: UseApprovalResult | null = null;
    let decisionPromise: Promise<void> | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) =>
        init?.method === "POST" ? decisionResponse.promise : Promise.resolve(
          Response.json({ id: "approval-1", status: "pending" }),
        )) as typeof fetch,
    );

    function Capture(): null {
      hook = useApproval({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "layout-user",
        onDecision,
      });
      const approve = hook.approve;
      useLayoutEffect(() => {
        decisionPromise = approve();
      }, [approve]);
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      assertEquals(hook!.isSubmitting, true);

      decisionResponse.resolve(Response.json({ resolvedBy: "server-user" }));
      await decisionPromise;
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isSubmitting, false);
      assertEquals(hook!.approval?.status, "approved");
      assertEquals(
        (hook!.approval as { resolvedBy?: string } | null)?.resolvedBy,
        "server-user",
      );
      assertEquals(decisions, ["server-user"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("coalesces concurrent decisions for the same approval", async () => {
    const restoreDom = installDom();
    const decisionResponse = Promise.withResolvers<Response>();
    const decisions: string[] = [];
    let postCount = 0;
    let hook: UseApprovalResult | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          postCount++;
          return decisionResponse.promise;
        }
        return Promise.resolve(Response.json({ id: "approval-1", status: "pending" }));
      }) as typeof fetch,
    );

    function Capture(): null {
      hook = useApproval({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "browser-user",
        onDecision: (decision) => decisions.push(decision.approver),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await new Promise((resolve) => setTimeout(resolve, 20));

      const winningDecision = hook!.approve();
      const duplicateDecision = hook!.reject();
      await Promise.resolve();
      assertEquals(postCount, 1, "only one decision may reach the atomic backend gate");

      decisionResponse.resolve(Response.json({ resolvedBy: "server-user" }));
      await Promise.all([winningDecision, duplicateDecision]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(hook!.isSubmitting, false);
      assertEquals(hook!.approval?.status, "approved");
      assertEquals(
        (hook!.approval as { resolvedBy?: string } | null)?.resolvedBy,
        "server-user",
      );
      assertEquals(decisions, ["server-user"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("keeps a layout-effect decision current after the approval context changes", async () => {
    const restoreDom = installDom();
    const decisionResponse = Promise.withResolvers<Response>();
    const decisions: string[] = [];
    const onDecision = (decision: { approver: string }): void => {
      decisions.push(decision.approver);
    };
    let hook: UseApprovalResult | null = null;
    let decisionPromise: Promise<void> | null = null;

    installMockFetch(
      ((input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") return decisionResponse.promise;
        return Promise.resolve(Response.json({
          id: String(input).split("/").at(-1),
          status: "pending",
        }));
      }) as typeof fetch,
    );

    function Capture({ approvalId, decide }: { approvalId: string; decide: boolean }): null {
      hook = useApproval({
        runId: "run-1",
        approvalId,
        approver: "layout-user",
        onDecision,
      });
      const approve = hook.approve;
      useLayoutEffect(() => {
        if (decide) decisionPromise = approve();
      }, [approve, decide]);
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture approvalId="approval-old" decide={false} />));
      await new Promise((resolve) => setTimeout(resolve, 20));

      flushSync(() => root.render(<Capture approvalId="approval-new" decide />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isSubmitting, true);

      decisionResponse.resolve(Response.json({ resolvedBy: "server-user" }));
      await decisionPromise;
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isSubmitting, false);
      assertEquals(hook!.approval?.id, "approval-new");
      assertEquals(hook!.approval?.status, "approved");
      assertEquals(decisions, ["server-user"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("ignores an obsolete start response after authorization changes", async () => {
    const restoreDom = installDom();
    const oldResponse = Promise.withResolvers<Response>();
    const startedRunIds: string[] = [];
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        return authorization === "Bearer old"
          ? oldResponse.promise
          : Promise.resolve(Response.json({ runId: "new-run" }));
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflowStart({
        workflowId: "workflow-1",
        headers: { Authorization: `Bearer ${token}` },
        onStart: (runId) => startedRunIds.push(runId),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      const obsoleteStart = hook!.start({});
      flushSync(() => root.render(<Capture token="new" />));

      oldResponse.resolve(Response.json({ runId: "old-run" }));
      assertEquals(await obsoleteStart, "old-run");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(hook!.lastRunId, null);
      assertEquals(startedRunIds, []);

      assertEquals(await hook!.start({}), "new-run");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.lastRunId, "new-run");
      assertEquals(startedRunIds, ["new-run"]);
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 0));
      restoreDom();
    }
  });

  it("hides the previous last run on the first render of a new authorization context", async () => {
    const restoreDom = installDom();
    const renderObservations: Array<{ lastRunId: string | null; token: string }> = [];
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        const token = new Headers(init?.headers).get("authorization")?.split(" ").at(-1);
        return Promise.resolve(Response.json({ runId: `${token}-run` }));
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflowStart({
        workflowId: "workflow-1",
        headers: { Authorization: `Bearer ${token}` },
      });
      renderObservations.push({ lastRunId: hook.lastRunId, token });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      await hook!.start({});
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.lastRunId, "old-run");

      renderObservations.length = 0;
      flushSync(() => root.render(<Capture token="new" />));
      assertEquals(renderObservations[0], { lastRunId: null, token: "new" });
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("ignores an obsolete approval response after authorization changes", async () => {
    const restoreDom = installDom();
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    let requestCount = 0;
    let hook: UseApprovalResult | null = null;

    installMockFetch(
      (() => {
        requestCount++;
        return requestCount === 1 ? firstResponse.promise : secondResponse.promise;
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useApproval({
        runId: "run-1",
        approvalId: "approval-1",
        headers: { Authorization: `Bearer ${token}` },
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      flushSync(() => root.render(<Capture token="new" />));

      secondResponse.resolve(Response.json({ id: "approval-1", message: "new session" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(requestCount, 2);
      assertEquals(hook!.approval?.message, "new session");

      firstResponse.resolve(Response.json({ id: "approval-1", message: "old session" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.approval?.message, "new session");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("hides approval data on the first render of a new request context", async () => {
    const restoreDom = installDom();
    const replacementResponse = Promise.withResolvers<Response>();
    const renderObservations: Array<{ approvalId: string | null; token: string }> = [];
    let hook: UseApprovalResult | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        return authorization === "Bearer old"
          ? Promise.resolve(Response.json({ id: "old-approval", status: "pending" }))
          : replacementResponse.promise;
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useApproval({
        runId: "run-1",
        approvalId: "approval-1",
        headers: { Authorization: `Bearer ${token}` },
      });
      renderObservations.push({ approvalId: hook.approval?.id ?? null, token });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.approval?.id, "old-approval");

      renderObservations.length = 0;
      flushSync(() => root.render(<Capture token="new" />));
      assertEquals(renderObservations[0], { approvalId: null, token: "new" });

      replacementResponse.resolve(Response.json({ id: "new-approval", status: "pending" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.approval?.id, "new-approval");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("ignores an obsolete approval decision after its request context changes", async () => {
    const restoreDom = installDom();
    const oldDecisionResponse = Promise.withResolvers<Response>();
    const decisions: string[] = [];
    let hook: UseApprovalResult | null = null;

    installMockFetch(
      ((input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") return oldDecisionResponse.promise;
        const approvalId = String(input).split("/").at(-1);
        return Promise.resolve(Response.json({
          id: approvalId,
          status: "pending",
          message: `${approvalId} pending`,
        }));
      }) as typeof fetch,
    );

    function Capture({ approvalId }: { approvalId: string }): null {
      hook = useApproval({
        runId: "run-1",
        approvalId,
        onDecision: (decision) => decisions.push(decision.approver),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture approvalId="approval-old" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const obsoleteDecision = hook!.approve();

      flushSync(() => root.render(<Capture approvalId="approval-new" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.approval?.id, "approval-new");

      oldDecisionResponse.resolve(Response.json({ resolvedBy: "old-session" }));
      await obsoleteDecision;
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(hook!.approval?.id, "approval-new");
      assertEquals(hook!.approval?.status, "pending");
      assertEquals(hook!.isSubmitting, false);
      assertEquals(decisions, []);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("ignores an obsolete list response after request options change", async () => {
    const restoreDom = installDom();
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    let requestCount = 0;
    let hook: UseWorkflowListResult | null = null;

    installMockFetch(
      (() => {
        requestCount++;
        return requestCount === 1 ? firstResponse.promise : secondResponse.promise;
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflowList({
        autoRefresh: false,
        headers: { Authorization: `Bearer ${token}` },
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      flushSync(() => root.render(<Capture token="new" />));

      secondResponse.resolve(Response.json({ runs: [], totalCount: 2 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(requestCount, 2);
      assertEquals(hook!.totalCount, 2);

      firstResponse.resolve(Response.json({ runs: [], totalCount: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.totalCount, 2);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("keeps loading active when an obsolete refresh finishes during replacement loading", async () => {
    const restoreDom = installDom();
    const oldRefreshResponse = Promise.withResolvers<Response>();
    const replacementResponse = Promise.withResolvers<Response>();
    let oldRequestCount = 0;
    let hook: UseWorkflowListResult | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization === "Bearer old") {
          oldRequestCount++;
          return oldRequestCount === 1
            ? Promise.resolve(Response.json({ runs: [] }))
            : oldRefreshResponse.promise;
        }
        return replacementResponse.promise;
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflowList({
        autoRefresh: false,
        headers: { Authorization: `Bearer ${token}` },
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isLoading, false);

      const obsoleteRefresh = hook!.refresh();
      flushSync(() => root.render(<Capture token="new" />));
      assertEquals(hook!.isLoading, true);

      oldRefreshResponse.resolve(Response.json({ runs: [] }));
      await obsoleteRefresh;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(
        hook!.isLoading,
        true,
        "the obsolete refresh must not clear loading for the replacement request",
      );

      replacementResponse.resolve(Response.json({ runs: [] }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.isLoading, false);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("does not let an obsolete list request hold the polling lock", async () => {
    const restoreDom = installDom();
    const oldResponse = Promise.withResolvers<Response>();
    let requestCount = 0;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        requestCount++;
        const authorization = new Headers(init?.headers).get("authorization");
        return authorization === "Bearer old"
          ? oldResponse.promise
          : Promise.resolve(Response.json({ runs: [] }));
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      useWorkflowList({
        autoRefresh: true,
        refreshInterval: 5,
        headers: { Authorization: `Bearer ${token}` },
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      flushSync(() => root.render(<Capture token="new" />));
      await new Promise((resolve) => setTimeout(resolve, 30));

      assertEquals(
        requestCount >= 3,
        true,
        "the new authorization context must continue polling while the old request hangs",
      );
      oldResponse.resolve(Response.json({ runs: [] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("clears workflow list data when authorization changes and refetch fails", async () => {
    const restoreDom = installDom();
    let hook: UseWorkflowListResult | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization === "Bearer old") {
          return Promise.resolve(Response.json({
            runs: [{ id: "old-run", status: "running" }],
            cursor: "old-cursor",
            totalCount: 1,
          }));
        }
        return Promise.resolve(new Response(null, { status: 401 }));
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflowList({
        autoRefresh: false,
        headers: { Authorization: `Bearer ${token}` },
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.runs.map((run) => run.id), ["old-run"]);
      assertEquals(hook!.totalCount, 1);

      flushSync(() => root.render(<Capture token="new" />));
      assertEquals(hook!.runs, [], "old authorization data must be hidden immediately");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.runs, []);
      assertEquals(hook!.totalCount, undefined);
      assertEquals(hook!.hasMore, false);
      assertEquals(hook!.error !== null, true);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("clears workflow run data when credentials change and refetch fails", async () => {
    const restoreDom = installDom();
    let hook: UseWorkflowResult | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.credentials === "include") {
          return Promise.resolve(Response.json({
            id: "old-run",
            status: "running",
            nodeStates: {},
            currentNodes: [],
            pendingApprovals: [{ id: "old-approval", status: "pending" }],
          }));
        }
        return Promise.resolve(new Response(null, { status: 403 }));
      }) as typeof fetch,
    );

    function Capture({ credentials }: { credentials: RequestCredentials }): null {
      hook = useWorkflow({
        runId: "run-1",
        autoRefresh: false,
        credentials,
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture credentials="include" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.run?.id, "old-run");
      assertEquals(hook!.pendingApprovals.map((approval) => approval.id), ["old-approval"]);

      flushSync(() => root.render(<Capture credentials="omit" />));
      assertEquals(hook!.run, null, "old credential data must be hidden immediately");
      assertEquals(hook!.pendingApprovals, []);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.run, null);
      assertEquals(hook!.error !== null, true);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("derives workflow state and callbacks from a run summary", async () => {
    const restoreDom = installDom();
    let hook: UseWorkflowResult | null = null;
    const completedRunIds: string[] = [];
    const approvalMessages: string[] = [];
    const onComplete: NonNullable<UseWorkflowOptions["onComplete"]> = (run) => {
      completedRunIds.push(run.id);
    };
    const onApprovalRequired: NonNullable<UseWorkflowOptions["onApprovalRequired"]> = (
      approval,
    ) => {
      approvalMessages.push(approval.message);
    };

    installMockFetch(
      (() =>
        Promise.resolve(Response.json({
          id: "run-summary",
          workflowId: "pipeline",
          status: "completed",
          currentNodes: [],
          nodeStates: {
            first: { nodeId: "first", status: "completed", attempt: 1 },
            second: { nodeId: "second", status: "skipped", attempt: 0 },
          },
          pendingApprovals: [{
            id: "approval-summary",
            nodeId: "review",
            status: "pending",
            message: "Review the result",
            requestedAt: "2026-08-30T10:01:00.000Z",
          }],
          createdAt: "2026-08-30T10:00:00.000Z",
          completedAt: "2026-08-30T10:02:00.000Z",
        }))) as typeof fetch,
    );

    function Capture(): null {
      hook = useWorkflow({
        runId: "run-summary",
        autoRefresh: false,
        onComplete,
        onApprovalRequired,
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(hook!.run?.id, "run-summary");
      assertEquals(hook!.status, "completed");
      assertEquals(hook!.progress, 100);
      assertEquals(hook!.nodeStates.second?.status, "skipped");
      assertEquals(hook!.pendingApprovals.map((approval) => approval.id), [
        "approval-summary",
      ]);
      assertEquals(completedRunIds, ["run-summary"]);
      assertEquals(approvalMessages, ["Review the result"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("does not fire run callbacks from a body parsed after authorization changes", async () => {
    const restoreDom = installDom();
    const oldBody = Promise.withResolvers<Record<string, unknown>>();
    const oldBodyStarted = Promise.withResolvers<void>();
    const completedRunIds: string[] = [];
    const approvalIds: string[] = [];
    let hook: UseWorkflowResult | null = null;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization === "Bearer old") {
          return Promise.resolve({
            ok: true,
            json: () => {
              oldBodyStarted.resolve();
              return oldBody.promise;
            },
          } as Response);
        }
        return Promise.resolve(Response.json({
          id: "new-run",
          status: "running",
          nodeStates: {},
          currentNodes: [],
          pendingApprovals: [],
        }));
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflow({
        runId: "run-1",
        autoRefresh: false,
        headers: { Authorization: `Bearer ${token}` },
        onComplete: (run) => completedRunIds.push(run.id),
        onApprovalRequired: (approval) => approvalIds.push(approval.id),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      await oldBodyStarted.promise;
      flushSync(() => root.render(<Capture token="new" />));
      await new Promise((resolve) => setTimeout(resolve, 20));

      oldBody.resolve({
        id: "old-run",
        status: "completed",
        nodeStates: {},
        currentNodes: [],
        pendingApprovals: [{ id: "old-approval", status: "pending" }],
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(hook!.run?.id, "new-run");
      assertEquals(completedRunIds, []);
      assertEquals(approvalIds, []);
    } finally {
      flushSync(() => root.unmount());
      await new Promise((resolve) => setTimeout(resolve, 0));
      restoreDom();
    }
  });

  it("ignores obsolete cancel and retry results after authorization changes", async () => {
    const restoreDom = installDom();
    const oldCancelResponse = Promise.withResolvers<Response>();
    const oldRetryResponse = Promise.withResolvers<Response>();
    let oldSessionReads = 0;
    let hook: UseWorkflowResult | null = null;

    installMockFetch(
      ((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (init?.method === "POST" && url.endsWith("/cancel")) {
          return oldCancelResponse.promise;
        }
        if (init?.method === "POST" && url.endsWith("/retry")) {
          return oldRetryResponse.promise;
        }
        if (authorization === "Bearer old") oldSessionReads++;
        return Promise.resolve(Response.json({
          id: authorization === "Bearer old" ? "old-run" : "new-run",
          status: "running",
          nodeStates: {},
          currentNodes: [],
          pendingApprovals: [],
        }));
      }) as typeof fetch,
    );

    function Capture({ token }: { token: string }): null {
      hook = useWorkflow({
        runId: "run-1",
        autoRefresh: false,
        headers: { Authorization: `Bearer ${token}` },
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture token="old" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const obsoleteCancel = hook!.cancel();
      const obsoleteRetry = hook!.retry();

      flushSync(() => root.render(<Capture token="new" />));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(hook!.run?.id, "new-run");

      const retryRejection = assertRejects(
        () => obsoleteRetry,
        Error,
        "Failed to retry workflow",
      );
      oldCancelResponse.resolve(Response.json({ status: "cancelled" }));
      oldRetryResponse.resolve(new Response(null, { status: 500 }));
      await obsoleteCancel;
      await retryRejection;
      await new Promise((resolve) => setTimeout(resolve, 20));

      assertEquals(hook!.run?.id, "new-run");
      assertEquals(hook!.error, null);
      assertEquals(oldSessionReads, 1, "an obsolete mutation must not refresh its old context");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("does not overlap slow workflow list polls", async () => {
    const restoreDom = installDom();
    const firstResponse = Promise.withResolvers<Response>();
    let requestCount = 0;

    installMockFetch(
      (() => {
        requestCount++;
        return requestCount === 1
          ? firstResponse.promise
          : Promise.resolve(Response.json({ runs: [] }));
      }) as typeof fetch,
    );

    function Capture(): null {
      useWorkflowList({ autoRefresh: true, refreshInterval: 5 });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await new Promise((resolve) => setTimeout(resolve, 30));
      assertEquals(requestCount, 1, "polling waits for the active replacement request");
      firstResponse.resolve(Response.json({ runs: [] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("does not refetch when inline authorization headers are semantically unchanged", async () => {
    const restoreDom = installDom();
    let fetchCount = 0;

    installMockFetch(
      ((input: string | URL | Request) => {
        fetchCount++;
        const url = String(input);
        if (url.includes("/approvals/")) {
          return Promise.resolve(Response.json({ id: "approval-1", status: "pending" }));
        }
        if (url.includes("/runs?")) {
          return Promise.resolve(Response.json({ runs: [], cursor: undefined }));
        }
        return Promise.resolve(Response.json({
          id: "run-1",
          status: "running",
          nodeStates: {},
          currentNodes: [],
          pendingApprovals: [],
        }));
      }) as typeof fetch,
    );

    function Capture(): null {
      const headers = { Authorization: "Bearer stable-token" };
      useApproval({ runId: "run-1", approvalId: "approval-1", headers });
      useWorkflow({ runId: "run-1", autoRefresh: false, headers });
      useWorkflowList({ autoRefresh: false, headers });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEquals(fetchCount, 3);

      flushSync(() => root.render(<Capture />));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assertEquals(fetchCount, 3);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("encodes workflow IDs before calling the handler route", async () => {
    const restoreDom = installDom();
    let requestedUrl = "";
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    installMockFetch(
      ((input: string | URL | Request) => {
        requestedUrl = String(input);
        return Promise.resolve(Response.json({ runId: "run-1" }));
      }) as typeof fetch,
    );

    function Capture(): null {
      hook = useWorkflowStart({
        workflowId: "billing:v2+manual",
        apiBase: "/api/workflows/",
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await hook!.start({});
      assertEquals(
        requestedUrl,
        "/api/workflows/billing%3Av2%2Bmanual/start",
      );
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("rejects dot-only workflow IDs before fetching", async () => {
    const restoreDom = installDom();
    let fetchCount = 0;
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    installMockFetch(
      (() => {
        fetchCount++;
        return Promise.resolve(Response.json({ runId: "unexpected" }));
      }) as typeof fetch,
    );

    function Capture({ workflowId }: { workflowId: string }): null {
      hook = useWorkflowStart({ workflowId });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      for (const workflowId of [".", ".."] as const) {
        flushSync(() => root.render(<Capture workflowId={workflowId} />));
        await assertRejects(() => hook!.start({}), TypeError, "path segment");
      }
      assertEquals(fetchCount, 0);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("accepts successful approval responses without an object body", async () => {
    const restoreDom = installDom();
    let hook: UseApprovalResult | null = null;
    const approvers: string[] = [];
    const approvalResponses = [
      new Response(null, { status: 204 }),
      Response.json(null),
      new Response("accepted"),
    ];
    let responseIndex = 0;

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) =>
        init?.method === "POST"
          ? Promise.resolve(approvalResponses[responseIndex++]!)
          : Promise.resolve(
            Response.json({ id: "approval-1", status: "pending" }),
          )) as typeof fetch,
    );

    function Capture(): null {
      hook = useApproval({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "legacy-user",
        onDecision: (decision) => approvers.push(decision.approver),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await hook!.approve();
      await hook!.approve();
      await hook!.approve();
      assertEquals(approvers, ["legacy-user", "legacy-user", "legacy-user"]);
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("uses the server-derived approver identity after a decision", async () => {
    const restoreDom = installDom();
    let hook: UseApprovalResult | null = null;
    const decisions: Array<{ approver: string }> = [];

    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Promise.resolve(Response.json({ resolvedBy: "session-user" }));
        }
        return Promise.resolve(Response.json({
          id: "approval-1",
          runId: "run-1",
          status: "pending",
          message: "Approve?",
          createdAt: new Date().toISOString(),
        }));
      }) as typeof fetch,
    );

    function Capture(): null {
      hook = useApproval({
        runId: "run-1",
        approvalId: "approval-1",
        approver: "impersonated-user",
        onDecision: (decision) => decisions.push(decision),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await hook!.approve();
      assertEquals(decisions[0]?.approver, "session-user");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("returns the production CSRF cookie in the workflow mutation header", async () => {
    const restoreDom = installDom();
    let requestHeaders = new Headers();
    let hook: UseWorkflowStartResult<{ topic: string }> | null = null;

    const startedRunIds: string[] = [];

    document.cookie = "__Host-vf_csrf=production-token; Path=/; Secure";
    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        requestHeaders = new Headers(init?.headers);
        return Promise.resolve(Response.json({ runId: "run-1" }));
      }) as typeof fetch,
    );

    function Capture(): null {
      hook = useWorkflowStart<{ topic: string }>({
        workflowId: "content-pipeline",
        headers: { "Content-Type": "text/plain" },
        onStart: (runId) => startedRunIds.push(runId),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      const runId = await hook!.start({ topic: "Production journey" });

      assertEquals(requestHeaders.get("content-type"), "application/json");
      assertEquals(requestHeaders.get("x-csrf-token"), "production-token");
      assertEquals(runId, "run-1", "start resolves the run id returned by the API");
      assertEquals(startedRunIds, ["run-1"], "onStart receives the started run id");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("protects start, approval, cancel, and retry mutations with the same token", async () => {
    const restoreDom = installDom();
    const mutationHeaders = new Map<string, Headers>();
    let startHook: UseWorkflowStartResult<Record<string, never>> | null = null;
    let approvalHook: UseApprovalResult | null = null;
    let workflowHook: UseWorkflowResult | null = null;

    document.cookie = "__Host-vf_csrf=shared-token; Path=/; Secure";
    installMockFetch(
      ((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST") mutationHeaders.set(url, new Headers(init?.headers));

        if (url.endsWith("/start")) return Promise.resolve(Response.json({ runId: "run-1" }));
        if (url.includes("/approvals/")) return Promise.resolve(Response.json({}));
        if (url.endsWith("/cancel") || url.endsWith("/retry")) {
          return Promise.resolve(Response.json({}));
        }
        return Promise.resolve(Response.json({
          id: "run-1",
          status: "running",
          nodeStates: {},
          currentNodes: [],
          pendingApprovals: [],
        }));
      }) as typeof fetch,
    );

    function Capture(): null {
      startHook = useWorkflowStart({ workflowId: "content-pipeline" });
      approvalHook = useApproval({ runId: "run-1", approvalId: "approval-1" });
      workflowHook = useWorkflow({ runId: "run-1", autoRefresh: false });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await startHook!.start({});
      await approvalHook!.approve();
      await workflowHook!.cancel();
      await workflowHook!.retry();

      for (
        const path of [
          "/api/workflows/content-pipeline/start",
          "/api/workflows/runs/run-1/approvals/approval-1",
          "/api/workflows/runs/run-1/cancel",
          "/api/workflows/runs/run-1/retry",
        ]
      ) {
        assertEquals(mutationHeaders.get(path)?.get("x-csrf-token"), "shared-token", path);
      }
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("does not send the page CSRF token to a cross-origin API base", async () => {
    const restoreDom = installDom();
    let requestHeaders = new Headers();
    let requestCredentials: RequestCredentials | undefined;
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    document.cookie = "__Host-vf_csrf=host-token; Path=/; Secure";
    installMockFetch(
      ((_input: string | URL | Request, init?: RequestInit) => {
        requestHeaders = new Headers(init?.headers);
        requestCredentials = init?.credentials;
        return Promise.resolve(Response.json({ runId: "run-1" }));
      }) as typeof fetch,
    );

    function Capture(): null {
      hook = useWorkflowStart({
        workflowId: "content-pipeline",
        apiBase: "https://workflows.example/api/workflows",
        headers: { Authorization: "Bearer public-session-token" },
        credentials: "include",
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await hook!.start({});

      assertEquals(requestHeaders.get("x-csrf-token"), null);
      assertEquals(requestHeaders.get("authorization"), "Bearer public-session-token");
      assertEquals(requestCredentials, "include");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });
  it("resolves the id field when the start response omits runId", async () => {
    const restoreDom = installDom();
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    installMockFetch((() => Promise.resolve(Response.json({ id: "run-2" }))) as typeof fetch);

    function Capture(): null {
      hook = useWorkflowStart({ workflowId: "content-pipeline" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));

      assertEquals(
        await hook!.start({}),
        "run-2",
        "start falls back to the id field when runId is absent",
      );
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });

  it("rejects when the start endpoint fails", async () => {
    const restoreDom = installDom();
    const reportedErrors: Error[] = [];
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    installMockFetch(
      (() => Promise.resolve(Response.json({ message: "nope" }, { status: 500 }))) as typeof fetch,
    );

    function Capture(): null {
      hook = useWorkflowStart({
        workflowId: "content-pipeline",
        onError: (startError) => reportedErrors.push(startError),
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));

      const error = await assertRejects(
        () => hook!.start({}),
        Error,
        "nope",
        "a failed start must reject instead of resolving an empty run id",
      );

      assertEquals(reportedErrors.length, 1, "onError receives the failure exactly once");
      assertEquals(reportedErrors[0], error, "onError receives the rejected error");
    } finally {
      flushSync(() => root.unmount());
      restoreDom();
    }
  });
});
