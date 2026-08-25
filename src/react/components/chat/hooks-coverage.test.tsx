/**
 * Behavioral coverage for the veryfront/chat hooks that do not have a focused
 * colocated suite. The tests drive clipboard, speech-recognition, completion,
 * streaming, and agent transport lifecycles through observable state and
 * callback transitions. Context-only hooks are verified to fail fast outside
 * their providers.
 *
 * @module react/components/chat/hooks-coverage.test
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit } from "#veryfront/testing/mock-fetch.ts";
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
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const replacements = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    self: dom.window,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  }
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  };
}

interface ProbeProps {
  use: () => unknown;
  onCapture: (value: unknown) => void;
}

function Probe({ use, onCapture }: ProbeProps): null {
  onCapture(use());
  return null;
}

/** Render a hook and keep exposing its latest result while async work settles. */
async function exerciseAsync<T>(
  hook: () => T,
  run: (current: () => T) => Promise<void>,
): Promise<void> {
  const restore = installDom();
  const root = createRoot(document.getElementById("root")!);
  let latest: T | undefined;
  let captured = false;

  function Capture(): null {
    latest = hook();
    captured = true;
    return null;
  }

  try {
    flushSync(() => root.render(<Capture />));
    await run(() => {
      flushSync(() => root.render(<Capture />));
      assert(captured, "hook result must be captured before use");
      return latest as T;
    });
  } finally {
    flushSync(() => root.unmount());
    restore();
  }
}

async function waitFor(
  condition: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function replaceFetch(
  implementation: typeof fetch,
): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => {
    globalThis.fetch = previous;
  };
}

/** A response whose body arrives in several chunks, so accumulation is observable. */
function chunkedResponse(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { status: 200 },
  );
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
          <Probe use={hook} onCapture={() => {}} />
        </Boundary>,
      )
    );
    flushSync(() => root.unmount());
    assert(caught !== null, "hook must throw outside its provider");
  } finally {
    restore();
  }
}

describe("veryfront/chat hook behavior", () => {
  it("useClipboard writes text and exposes successful feedback", async () => {
    await exerciseAsync(() => useClipboard("Copied answer"), async (current) => {
      const ownerNavigator = document.defaultView?.navigator;
      assert(ownerNavigator, "clipboard test requires a window navigator");
      const clipboardDescriptor = Object.getOwnPropertyDescriptor(ownerNavigator, "clipboard");
      let written = "";
      Object.defineProperty(ownerNavigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            written = text;
            return Promise.resolve();
          },
        },
      });
      try {
        current().copy(document);
        assertEquals(written, "Copied answer");
        await waitFor(() => current().copied, "clipboard feedback did not settle");
        assertEquals(current().failed, false);
      } finally {
        if (clipboardDescriptor) {
          Object.defineProperty(ownerNavigator, "clipboard", clipboardDescriptor);
        } else {
          Reflect.deleteProperty(ownerNavigator, "clipboard");
        }
      }
    });
  });

  it("useVoiceInput configures recognition and publishes transcript state", async () => {
    type ResultEvent = {
      resultIndex: number;
      results: Array<{
        0: { transcript: string; confidence: number };
        isFinal: boolean;
      }>;
    };

    let recognition: MockSpeechRecognition | undefined;
    let aborts = 0;
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: ResultEvent) => void) | null = null;
      onerror: ((event: { error: string; message: string }) => void) | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        recognition = this;
      }

      start(): void {
        this.onstart?.();
      }

      stop(): void {
        this.onend?.();
      }

      abort(): void {
        aborts += 1;
      }

      emitResult(transcript: string, isFinal: boolean): void {
        this.onresult?.({
          resultIndex: 0,
          results: [{
            0: { transcript, confidence: 1 },
            isFinal,
          }],
        });
      }
    }

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "SpeechRecognition");
    Object.defineProperty(globalThis, "SpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    const transcripts: Array<[string, boolean]> = [];
    const handleTranscript = (text: string, isFinal: boolean): void => {
      transcripts.push([text, isFinal]);
    };
    try {
      await exerciseAsync(
        () =>
          useVoiceInput({
            language: "sv-SE",
            continuous: true,
            interimResults: false,
            onTranscript: handleTranscript,
          }),
        async (current) => {
          assert(current().isSupported);
          assert(recognition, "speech recognition must be constructed after mount");
          assertEquals(recognition.lang, "sv-SE");
          assertEquals(recognition.continuous, true);
          assertEquals(recognition.interimResults, false);

          const voice = current();
          flushSync(() => voice.start());
          assertEquals(current().isListening, true);

          flushSync(() => recognition?.emitResult("Hej världen", true));
          assertEquals(current().transcript, "Hej världen");
          assertEquals(transcripts, [["Hej världen", true]]);

          const listeningVoice = current();
          flushSync(() => listeningVoice.stop());
          assertEquals(current().isListening, false);
          const settledVoice = current();
          flushSync(() => settledVoice.clear());
          assertEquals(current().transcript, "");
          await Promise.resolve();
        },
      );
      assertEquals(aborts, 1, "unmount must abort the recognition instance");
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "SpeechRecognition", descriptor);
      } else {
        Reflect.deleteProperty(globalThis, "SpeechRecognition");
      }
    }
  });

  it("useCompletion streams text and reports the completed value", async () => {
    let requestBody: unknown;
    let finished = "";
    const restoreFetch = replaceFetch(async (_input, init) => {
      requestBody = JSON.parse(String(observeFetchRequestInit(init).body));
      return chunkedResponse(["Generated ", "answer"]);
    });
    try {
      await exerciseAsync(
        () =>
          useCompletion({
            api: "/api/completion",
            body: { model: "test-model" },
            onFinish: (text) => finished = text,
          }),
        async (current) => {
          await current().complete("Write an answer");
          await waitFor(() => !current().isLoading, "completion did not settle");
          assertEquals(
            current().completion,
            "Generated answer",
            "the completion accumulates every chunk rather than holding only the last one",
          );
          assertEquals(finished, "Generated answer");
          assertEquals(requestBody, {
            prompt: "Write an answer",
            model: "test-model",
          });
        },
      );
    } finally {
      restoreFetch();
    }
  });

  it("useStreaming accumulates chunks and reports completion", async () => {
    const chunks: string[] = [];
    let completions = 0;
    const restoreFetch = replaceFetch(async () => chunkedResponse(["streamed ", "value"]));
    try {
      await exerciseAsync(
        () =>
          useStreaming({
            url: "/api/stream",
            onChunk: (chunk) => chunks.push(chunk),
            onComplete: () => completions += 1,
          }),
        async (current) => {
          await current().start({ topic: "composition" });
          await waitFor(() => !current().isStreaming, "stream did not settle");
          assertEquals(
            current().data,
            "streamed value",
            "data accumulates every chunk rather than holding only the last one",
          );
          assertEquals(
            chunks,
            ["streamed ", "value"],
            "each stream chunk is delivered separately to onChunk",
          );
          assertEquals(completions, 1);
          const stream = current();
          flushSync(() => stream.reset());
          assertEquals(current().data, "");
        },
      );
    } finally {
      restoreFetch();
    }
  });

  it("useChatInputContext fails fast outside a ChatInput provider", () => {
    expectFailFast(() => useChatInputContext());
  });

  it("useMessageBranches fails fast outside a Message provider", () => {
    expectFailFast(() => useMessageBranches());
  });

  it("useAgents fetches, normalizes, and refetches the agent list", async () => {
    let requests = 0;
    const restoreFetch = replaceFetch(async (input, init) => {
      requests += 1;
      assertEquals(String(input), "/api/agents");
      assertEquals(
        new Headers(observeFetchRequestInit(init).headers).get("accept"),
        "application/json",
      );
      return Response.json({
        agents: [{
          id: "support",
          name: "Support",
          description: "Answers questions",
          avatar_url: "https://example.com/support.png",
        }],
      });
    });
    try {
      await exerciseAsync(() => useAgents(), async (current) => {
        await waitFor(() => !current().isLoading, "agent list did not settle");
        assertEquals(current().agents, [{
          id: "support",
          name: "Support",
          description: "Answers questions",
          avatarUrl: "https://example.com/support.png",
          suggestions: undefined,
        }]);
        assertEquals(current().error, null);

        const agents = current();
        flushSync(() => agents.refetch());
        await waitFor(
          () => requests === 2 && !current().isLoading,
          "agent list refetch did not settle",
        );
      });
      assertEquals(requests, 2);
    } finally {
      restoreFetch();
    }
  });

  it("useAgent invokes the selected agent and publishes its result", async () => {
    let requestBody: unknown;
    const restoreFetch = replaceFetch(async (input, init) => {
      assertEquals(String(input), "/api/agents/support");
      const observedInit = observeFetchRequestInit(init);
      assertEquals(observedInit.method, "POST");
      requestBody = JSON.parse(String(observedInit.body));
      return Response.json({
        messages: [],
        toolCalls: [],
        status: "completed",
        thinking: "Finished reasoning",
      });
    });
    try {
      await exerciseAsync(() => useAgent({ agent: "support" }), async (current) => {
        await current().invoke("Help me");
        await waitFor(() => !current().isLoading, "agent invocation did not settle");
        assertEquals(current().status, "completed");
        assertEquals(current().thinking, "Finished reasoning");
        assertEquals(current().messages, []);
        assertEquals(current().toolCalls, []);
        assertEquals(current().error, null);
        assertEquals(requestBody, { input: "Help me", messages: [] });
      });
    } finally {
      restoreFetch();
    }
  });

  it("useAgent surfaces a non-ok response as an error state", async () => {
    const errors: Error[] = [];
    const restoreFetch = replaceFetch(() => Promise.resolve(new Response("nope", { status: 500 })));
    try {
      await exerciseAsync(
        () => useAgent({ agent: "support", onError: (error) => errors.push(error) }),
        async (current) => {
          await current().invoke("Help me");
          await waitFor(() => !current().isLoading, "agent invocation did not settle");
          assertEquals(
            current().status,
            "error",
            "a 500 must leave the agent in the error status",
          );
          const failure = current().error;
          assert(failure instanceof Error, "the failure is published on error");
          assert(
            failure.message.includes("500"),
            "the status code reaches the consumer",
          );
          assertEquals(errors.length, 1, "onError fires exactly once");
        },
      );
    } finally {
      restoreFetch();
    }
  });
});
