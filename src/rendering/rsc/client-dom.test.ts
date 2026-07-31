import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { HYDRATION_DATA_ID, RSC_DEPENDENCY_PINNING_HEADER, RSC_ROOT_ID } from "./constants.ts";
import { consumeNdjsonStream } from "./client-dom.ts";

class MockElement {
  id = "";
  textContent = "";
  dataset: Record<string, string> = {};
  children: MockElement[] = [];
  private rawInnerHtml = "";

  constructor(readonly tagName: string) {}

  get innerHTML(): string {
    return this.rawInnerHtml;
  }

  set innerHTML(value: string) {
    this.rawInnerHtml = value;
    this.children = parseChildren(value);
  }

  appendChild(child: MockElement): MockElement {
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): MockElement | null {
    const match = selector.match(/^\[data-client-ref='(.+)'\]$/);
    if (!match) return null;

    const target = match[1];
    return findByPredicate(this, (node) => node.dataset.clientRef === target);
  }
}

class MockDocument {
  readonly body = new MockElement("body");

  createElement(tagName: string): MockElement {
    return new MockElement(tagName.toUpperCase());
  }

  getElementById(id: string): MockElement | null {
    return findByPredicate(this.body, (node) => node.id === id);
  }
}

function createDocument(): Document {
  return new MockDocument() as unknown as Document;
}

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function findByPredicate(
  node: MockElement,
  predicate: (node: MockElement) => boolean,
): MockElement | null {
  for (const child of node.children) {
    if (predicate(child)) return child;
    const nested = findByPredicate(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function parseChildren(html: string): MockElement[] {
  const elementPattern = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>/g;
  const children: MockElement[] = [];

  for (const match of html.matchAll(elementPattern)) {
    const tagName = match[1] ?? "div";
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const element = new MockElement(tagName.toUpperCase());

    for (const attrMatch of attrs.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)) {
      const name = attrMatch[1] ?? "";
      const value = attrMatch[2] ?? "";
      if (name === "id") {
        element.id = value;
        continue;
      }

      if (name.startsWith("data-")) {
        element.dataset[toDatasetKey(name.slice(5))] = value;
      }
    }

    element.innerHTML = inner;
    children.push(element);
  }

  return children;
}

function toDatasetKey(value: string): string {
  return value.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}

describe("rendering/rsc/client-dom", () => {
  it("admits an exact stream snapshot before applying its chunks", async () => {
    const doc = createDocument();
    const hydrationData = doc.createElement("script") as unknown as MockElement;
    hydrationData.id = HYDRATION_DATA_ID;
    hydrationData.textContent = JSON.stringify({
      reactVersion: "19.2.4",
      dependencyPinningCacheKey: "on:1",
    });
    (doc.body as unknown as MockElement).appendChild(hydrationData);

    await consumeNdjsonStream(
      new Response(
        '{"type":"slot","id":"root","html":"<div>Ready</div>"}\n',
        {
          headers: {
            [RSC_DEPENDENCY_PINNING_HEADER]: "on:1",
          },
        },
      ),
      doc,
      undefined,
      { requestedDependencyPinningCacheKey: "on:1" },
    );

    assertEquals(JSON.parse(hydrationData.textContent), {
      reactVersion: "19.2.4",
      dependencyPinningCacheKey: "on:1",
    });
    assertEquals(doc.getElementById(RSC_ROOT_ID)?.innerHTML, "<div>Ready</div>");
  });

  it("reloads and leaves the DOM untouched when a stream snapshot is not exact", async () => {
    for (
      const [current, requested, responseHeader] of [
        ["on:1", "on:1", null],
        ["on:1", "on:1", "on:not-canonical"],
        ["on:1", "on:1", "on:2"],
        [undefined, undefined, "on:1"],
      ] as const
    ) {
      const doc = createDocument();
      if (current !== undefined) {
        const hydrationData = doc.createElement("script") as unknown as MockElement;
        hydrationData.id = HYDRATION_DATA_ID;
        hydrationData.textContent = JSON.stringify({
          dependencyPinningCacheKey: current,
        });
        (doc.body as unknown as MockElement).appendChild(hydrationData);
      }
      let recoveries = 0;
      const headers = responseHeader === null
        ? undefined
        : { [RSC_DEPENDENCY_PINNING_HEADER]: responseHeader };

      await assertRejects(
        () =>
          consumeNdjsonStream(
            new Response(
              '{"type":"slot","id":"root","html":"<div>Must not render</div>"}\n',
              { headers },
            ),
            doc,
            undefined,
            {
              requestedDependencyPinningCacheKey: requested,
              recoverFromAdmissionFailure: () => {
                recoveries++;
                return true;
              },
            },
          ),
        Error,
        "Dependency snapshot admission failed",
      );

      assertEquals(recoveries, 1);
      assertEquals(doc.getElementById(RSC_ROOT_ID), null);
    }
  });

  it("applies streamed slot HTML without claiming React hydration completed", async () => {
    const doc = createDocument();

    await consumeNdjsonStream(
      createStream([
        '{"type":"slot","id":"root","html":"<button data-client-ref=\\"Counter\\">Click</button>"}\n',
      ]),
      doc,
    );

    const root = doc.getElementById(RSC_ROOT_ID);
    assertExists(root);
    assertEquals(root.innerHTML.includes("Click"), true);

    const button = root.querySelector("[data-client-ref='Counter']") as HTMLElement | null;
    assertExists(button);
    assertEquals(button.dataset.hydrated, undefined);
  });

  it("buffers partial NDJSON lines and ignores malformed chunks", async () => {
    const doc = createDocument();

    await consumeNdjsonStream(
      createStream([
        '{"type":"slot","id":"root","html":"<div>Par',
        'sed</div>"}\nnot-json\n{"type":"slot","id":"sidebar","html":"<div>Ready</div>"}\n',
      ]),
      doc,
    );

    const root = doc.getElementById(RSC_ROOT_ID);
    const sidebar = doc.getElementById("rsc-slot-sidebar");

    assertExists(root);
    assertExists(sidebar);
    assertEquals(root.innerHTML.includes("Parsed"), true);
    assertEquals(sidebar.innerHTML.includes("Ready"), true);
  });

  it("aborts pending reads and cancels the underlying stream", async () => {
    const doc = createDocument();
    const controller = new AbortController();
    let cancelCount = 0;

    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Leave the stream open so consumeNdjsonStream blocks on reader.read().
      },
      cancel() {
        cancelCount++;
      },
    });

    const pending = consumeNdjsonStream(stream, doc, controller.signal);
    controller.abort();

    await assertRejects(
      () => pending,
      DOMException,
      "aborted",
    );
    assertEquals(cancelCount > 0, true);
  });

  it("installs one abort listener for the complete stream lifecycle", async () => {
    const doc = createDocument();
    const controller = new AbortController();
    const signal = controller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);
    let additions = 0;
    let removals = 0;

    signal.addEventListener = ((...args: Parameters<AbortSignal["addEventListener"]>) => {
      additions++;
      return originalAdd(...args);
    }) as AbortSignal["addEventListener"];
    signal.removeEventListener = ((...args: Parameters<AbortSignal["removeEventListener"]>) => {
      removals++;
      return originalRemove(...args);
    }) as AbortSignal["removeEventListener"];

    await consumeNdjsonStream(
      createStream([
        '{"type":"slot","id":"one","html":"<div>One</div>"}\n',
        '{"type":"slot","id":"two","html":"<div>Two</div>"}\n',
        '{"type":"slot","id":"three","html":"<div>Three</div>"}\n',
      ]),
      doc,
      signal,
    );

    assertEquals(additions, 1);
    assertEquals(removals, 1);
  });

  it("rejects an unterminated NDJSON record beyond the client buffer budget", async () => {
    const doc = createDocument();
    const oversizedRecord = "x".repeat(1024 * 1024 + 1);

    await assertRejects(
      () => consumeNdjsonStream(createStream([oversizedRecord]), doc),
      Error,
      "buffer limit",
    );
  });

  it("ignores malformed slot records instead of creating attacker-selected containers", async () => {
    const doc = createDocument();

    await consumeNdjsonStream(
      createStream([
        '{"type":"slot","id":{"nested":true},"html":"bad id"}\n',
        '{"type":"slot","id":"../escape","html":"unsafe id"}\n',
        '{"type":"slot","id":"sidebar","html":{"nested":true}}\n',
        '{"type":"slot","id":"sidebar","html":"<div>Ready</div>"}\n',
      ]),
      doc,
    );

    assertEquals(doc.getElementById("rsc-slot-[object Object]"), null);
    assertEquals(doc.getElementById("rsc-slot-../escape"), null);
    assertEquals(doc.getElementById("rsc-slot-sidebar")?.innerHTML, "<div>Ready</div>");
  });

  it("bounds the number of distinct streamed slots", async () => {
    const doc = createDocument();
    const records = Array.from(
      { length: 257 },
      (_, index) =>
        JSON.stringify({
          type: "slot",
          id: `slot-${index}`,
          html: `<div>${index}</div>`,
        }) + "\n",
    );

    await assertRejects(
      () => consumeNdjsonStream(createStream(records), doc),
      Error,
      "slot limit",
    );
  });
});
