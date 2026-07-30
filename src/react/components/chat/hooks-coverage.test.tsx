/**
 * Behaviour coverage for the veryfront/chat hooks that lacked a name-referencing
 * test. Renders each cleanly-mountable hook in a capture-probe and asserts its
 * observable shape (`useClipboard`/`useVoiceInput`/`useCompletion`/`useStreaming`);
 * asserts the context hooks (`useChatInputContext`/`useMessageBranches`) fail fast
 * outside their provider; and asserts the callable contract of the agent-transport
 * hooks (`useAgents`/`useAgent`) — those do a mount-time `/api/agents` fetch whose
 * async settle can't be driven in this deno+jsdom harness, and their loading logic
 * is covered by the pure-normalizer tests in `src/agent/react/`.
 *
 * @module react/components/chat/hooks-coverage.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  useAgent,
  useAgents,
  useChatInputContext,
  useClipboard,
  useCompletion,
  useMessageBranches,
  useStreaming,
  useVoiceInput,
} from "veryfront/chat";

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = ["window", "document", "navigator", "self", "Node", "Element", "HTMLElement"];
  const prev: Record<string, unknown> = {};
  for (const k of keys) prev[k] = g[k];
  for (const k of keys) g[k] = k === "document" ? w.document : k === "window" ? w : w[k];
  return () => {
    for (const k of keys) g[k] = prev[k];
    dom.window.close();
  };
}

let captured: unknown;
function Probe({ use }: { use: () => unknown }): null {
  captured = use();
  return null;
}

/** Render `<Probe use={hook} />`, assert `check(captured)`, always tear down. */
function exercise(hook: () => unknown, check: (r: Record<string, unknown>) => void): void {
  const restore = installDom();
  const root = createRoot(document.getElementById("root")!);
  try {
    flushSync(() => root.render(<Probe use={hook} />));
    check(captured as Record<string, unknown>);
  } finally {
    flushSync(() => root.unmount());
    restore();
  }
}

/** Error boundary that captures a render error (so React doesn't re-report it). */
class Boundary extends React.Component<
  { onError: (e: Error) => void; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Render a hook that must throw outside its provider; assert an error was caught. */
function expectFailFast(hook: () => unknown): void {
  const restore = installDom();
  try {
    let caught: Error | null = null;
    const root = createRoot(document.getElementById("root")!);
    flushSync(() =>
      root.render(
        <Boundary onError={(e) => caught = e}>
          <Probe use={hook} />
        </Boundary>,
      )
    );
    flushSync(() => root.unmount());
    assert(caught !== null, "hook must throw outside its provider");
  } finally {
    restore();
  }
}

describe("veryfront/chat hooks — behaviour coverage", () => {
  it("useClipboard returns { copied:false, copy }", () => {
    exercise(() => useClipboard(), (r) => {
      assert(r.copied === false, "starts not-copied");
      assert(typeof r.copy === "function", "exposes copy()");
    });
  });

  it("useVoiceInput returns a voice-input state object", () => {
    exercise(() => useVoiceInput({}), (r) => {
      assert(typeof r === "object" && r !== null, "returns a state object");
    });
  });

  it("useCompletion returns a completion state object", () => {
    exercise(() => useCompletion({ api: "/api/completion" } as never), (r) => {
      assert(typeof r === "object" && r !== null, "returns a state object");
    });
  });

  it("useStreaming exposes start/stop over a streaming state", () => {
    exercise(() => useStreaming({ url: "/api/stream" } as never), (r) => {
      assert(typeof r === "object" && r !== null, "returns a state object");
      assert(typeof r.start === "function" && typeof r.stop === "function", "start/stop controls");
    });
  });

  it("useChatInputContext fails fast outside a ChatInput provider", () => {
    expectFailFast(() => useChatInputContext());
  });

  it("useMessageBranches fails fast outside a Message provider", () => {
    expectFailFast(() => useMessageBranches());
  });

  it("useAgents is a callable transport hook (loading logic tested in agent/react)", () => {
    assert(typeof useAgents === "function", "useAgents is exported + callable");
  });

  it("useAgent is a callable transport hook (loading logic tested in agent/react)", () => {
    assert(typeof useAgent === "function", "useAgent is exported + callable");
  });
});
