import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useApproval, type UseApprovalResult } from "./use-approval.ts";
import { useWorkflow, type UseWorkflowResult } from "./use-workflow.ts";
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
  it("ignores an obsolete approval response after authorization changes", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    let requestCount = 0;
    let hook: UseApprovalResult | null = null;

    globalThis.fetch = (() => {
      requestCount++;
      return requestCount === 1 ? firstResponse.promise : secondResponse.promise;
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("ignores an obsolete list response after request options change", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    let requestCount = 0;
    let hook: UseWorkflowListResult | null = null;

    globalThis.fetch = (() => {
      requestCount++;
      return requestCount === 1 ? firstResponse.promise : secondResponse.promise;
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("does not overlap slow workflow list polls", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const firstResponse = Promise.withResolvers<Response>();
    let requestCount = 0;

    globalThis.fetch = (() => {
      requestCount++;
      return requestCount === 1
        ? firstResponse.promise
        : Promise.resolve(Response.json({ runs: [] }));
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("does not refetch when inline authorization headers are semantically unchanged", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;

    globalThis.fetch = ((input: string | URL | Request) => {
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
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("encodes workflow IDs before calling the handler route", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    globalThis.fetch = ((input: string | URL | Request) => {
      requestedUrl = String(input);
      return Promise.resolve(Response.json({ runId: "run-1" }));
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("rejects dot-only workflow IDs before fetching", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    globalThis.fetch = (() => {
      fetchCount++;
      return Promise.resolve(Response.json({ runId: "unexpected" }));
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("accepts successful approval responses without an object body", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let hook: UseApprovalResult | null = null;
    const approvers: string[] = [];
    const approvalResponses = [
      new Response(null, { status: 204 }),
      Response.json(null),
      new Response("accepted"),
    ];
    let responseIndex = 0;

    globalThis.fetch =
      ((_input: string | URL | Request, init?: RequestInit) =>
        init?.method === "POST"
          ? Promise.resolve(approvalResponses[responseIndex++]!)
          : Promise.resolve(
            Response.json({ id: "approval-1", status: "pending" }),
          )) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("uses the server-derived approver identity after a decision", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let hook: UseApprovalResult | null = null;
    const decisions: Array<{ approver: string }> = [];

    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
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
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("returns the production CSRF cookie in the workflow mutation header", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestHeaders = new Headers();
    let hook: UseWorkflowStartResult<{ topic: string }> | null = null;

    const startedRunIds: string[] = [];

    document.cookie = "__Host-vf_csrf=production-token; Path=/; Secure";
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ runId: "run-1" }));
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("protects start, approval, cancel, and retry mutations with the same token", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const mutationHeaders = new Map<string, Headers>();
    let startHook: UseWorkflowStartResult<Record<string, never>> | null = null;
    let approvalHook: UseApprovalResult | null = null;
    let workflowHook: UseWorkflowResult | null = null;

    document.cookie = "__Host-vf_csrf=shared-token; Path=/; Secure";
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
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
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("does not send the page CSRF token to a cross-origin API base", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestHeaders = new Headers();
    let requestCredentials: RequestCredentials | undefined;
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    document.cookie = "__Host-vf_csrf=host-token; Path=/; Secure";
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      requestCredentials = init?.credentials;
      return Promise.resolve(Response.json({ runId: "run-1" }));
    }) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });
  it("resolves the id field when the start response omits runId", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    globalThis.fetch = (() => Promise.resolve(Response.json({ id: "run-2" }))) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });

  it("rejects when the start endpoint fails", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    const reportedErrors: Error[] = [];
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    globalThis.fetch =
      (() => Promise.resolve(Response.json({ message: "nope" }, { status: 500 }))) as typeof fetch;

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
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });
});
