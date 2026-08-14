import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { useApproval, type UseApprovalResult } from "./use-approval.ts";
import { useWorkflow, type UseWorkflowResult } from "./use-workflow.ts";
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
  it("returns the production CSRF cookie in the workflow mutation header", async () => {
    const restoreDom = installDom();
    const originalFetch = globalThis.fetch;
    let requestHeaders = new Headers();
    let hook: UseWorkflowStartResult<{ topic: string }> | null = null;

    document.cookie = "__Host-vf_csrf=production-token; Path=/; Secure";
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ runId: "run-1" }));
    }) as typeof fetch;

    function Capture(): null {
      hook = useWorkflowStart<{ topic: string }>({ workflowId: "content-pipeline" });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await hook!.start({ topic: "Production journey" });

      assertEquals(requestHeaders.get("content-type"), "application/json");
      assertEquals(requestHeaders.get("x-csrf-token"), "production-token");
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
    let hook: UseWorkflowStartResult<Record<string, never>> | null = null;

    document.cookie = "__Host-vf_csrf=host-token; Path=/; Secure";
    globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Promise.resolve(Response.json({ runId: "run-1" }));
    }) as typeof fetch;

    function Capture(): null {
      hook = useWorkflowStart({
        workflowId: "content-pipeline",
        apiBase: "https://workflows.example/api/workflows",
      });
      return null;
    }

    const root = createRoot(document.getElementById("root")!);
    try {
      flushSync(() => root.render(<Capture />));
      await hook!.start({});

      assertEquals(requestHeaders.get("x-csrf-token"), null);
    } finally {
      flushSync(() => root.unmount());
      globalThis.fetch = originalFetch;
      restoreDom();
    }
  });
});
