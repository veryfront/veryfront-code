import { flushSync } from "react-dom";
import { JSDOM } from "npm:jsdom@28.0.0";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export class ObjectResponse extends Response {
  constructor(private readonly value: unknown, status = 200) {
    super(null, { status });
  }

  override json(): Promise<unknown> {
    return Promise.resolve(this.value);
  }
}

export function installHookDom(): () => void {
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

export function installFetch(queue: Deferred<Response>[]) {
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

export async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

export function workflowRunWire(
  id: string,
  status: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled" = "running",
): Record<string, unknown> {
  return {
    id,
    workflowId: "workflow-1",
    status,
    input: { request: id },
    nodeStates: {
      "node-1": {
        nodeId: "node-1",
        status: status === "completed" ? "completed" : "running",
        attempt: 1,
        startedAt: "2026-07-31T10:00:00.000Z",
        ...(status === "completed" ? { completedAt: "2026-07-31T10:00:01.000Z" } : {}),
      },
    },
    currentNodes: status === "completed" ? [] : ["node-1"],
    context: { input: { request: id }, nested: { preserved: true } },
    checkpoints: [],
    pendingApprovals: [],
    createdAt: "2026-07-31T09:59:59.000Z",
    startedAt: "2026-07-31T10:00:00.000Z",
    ...(status === "completed" ? { completedAt: "2026-07-31T10:00:01.000Z" } : {}),
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
  };
}
