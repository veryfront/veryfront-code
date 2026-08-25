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
  parentElement: MockElement | null = null;
  private rawInnerHtml = "";
  private readonly attributes = new Map<string, string>();

  constructor(readonly tagName: string) {}

  get innerHTML(): string {
    return this.rawInnerHtml;
  }

  set innerHTML(value: string) {
    this.rawInnerHtml = value;
    this.children = parseChildren(value);
    for (const child of this.children) child.parentElement = this;
  }

  get firstElementChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
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

  querySelectorAll(selector: string): MockElement[] {
    if (selector !== `[id="${HYDRATION_DATA_ID}"]`) return [];
    return findAllByPredicate(this.body, (node) => node.id === HYDRATION_DATA_ID);
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

function findAllByPredicate(
  node: MockElement,
  predicate: (node: MockElement) => boolean,
): MockElement[] {
  const matches: MockElement[] = [];
  for (const child of node.children) {
    if (predicate(child)) matches.push(child);
    matches.push(...findAllByPredicate(child, predicate));
  }
  return matches;
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
  it("seeds the render snapshot from a stream before applying its chunks", async () => {
    const doc = createDocument();
    const hydrationData = doc.createElement("script") as unknown as MockElement;
    hydrationData.id = HYDRATION_DATA_ID;
    hydrationData.setAttribute("type", "application/json");
    hydrationData.textContent = JSON.stringify({ reactVersion: "19.2.4" });
    (doc.body as unknown as MockElement).appendChild(hydrationData);

    // Record the snapshot the document carries when the first chunk is pulled,
    // so the assertion sees the ordering and not just the final state.
    let snapshotAtFirstChunk: string | undefined;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        snapshotAtFirstChunk ??= hydrationData.textContent;
        controller.enqueue(
          new TextEncoder().encode('{"type":"slot","id":"root","html":"<div>Ready</div>"}\n'),
        );
        controller.close();
      },
    });

    await consumeNdjsonStream(
      new Response(body, {
        headers: {
          [RSC_DEPENDENCY_PINNING_HEADER]: "on:pins-a",
        },
      }),
      doc,
    );

    assertExists(snapshotAtFirstChunk, "the stream body was consumed");
    assertEquals(
      JSON.parse(snapshotAtFirstChunk).dependencyPinningCacheKey,
      "on:pins-a",
      "the snapshot must be seeded before the first chunk is applied",
    );
    assertEquals(JSON.parse(hydrationData.textContent), {
      reactVersion: "19.2.4",
      dependencyPinningCacheKey: "on:pins-a",
    });
    assertEquals(
      doc.getElementById(RSC_ROOT_ID)?.innerHTML.includes("Ready"),
      true,
      "the streamed slot must be applied",
    );
  });

  it("applies streamed slot HTML and marks client boundaries as hydrated", async () => {
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
    assertEquals(button.dataset.hydrated, "true");
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

  it("renders a final NDJSON line delivered without a trailing newline", async () => {
    const doc = createDocument();

    await consumeNdjsonStream(
      createStream([
        '{"type":"slot","id":"root","htm',
        'l":"<div>Last</div>"}',
      ]),
      doc,
    );

    const root = doc.getElementById(RSC_ROOT_ID);
    assertExists(root);
    assertEquals(
      root.innerHTML.includes("Last"),
      true,
      "the last line is flushed when the stream closes without a newline",
    );
  });

  it("rejects streamed slot HTML carrying an event handler attribute", async () => {
    const doc = createDocument();

    await assertRejects(
      () =>
        consumeNdjsonStream(
          createStream([
            '{"type":"slot","id":"root","html":"<div onclick=\\"steal()\\"></div>"}\n',
          ]),
          doc,
        ),
      Error,
      "Potentially unsafe HTML",
      "a suspicious slot payload must be rejected by validateTrustedHtml",
    );

    assertEquals(
      doc.getElementById(RSC_ROOT_ID)?.innerHTML ?? "",
      "",
      "unsafe HTML must not reach the DOM",
    );
  });

  it("rejects streamed slot HTML carrying an inline script", async () => {
    const doc = createDocument();

    await assertRejects(
      () =>
        consumeNdjsonStream(
          createStream([
            '{"type":"slot","id":"root","html":"<script>steal()<\\/script>"}\n',
          ]),
          doc,
        ),
      Error,
      "Potentially unsafe HTML",
      "an inline script in a slot payload must be rejected",
    );

    assertEquals(
      doc.getElementById(RSC_ROOT_ID)?.innerHTML ?? "",
      "",
      "inline script HTML must not reach the DOM",
    );
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
});
