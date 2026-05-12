import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RSC_ROOT_ID } from "./constants.ts";
import { consumeNdjsonStream } from "./client-dom.ts";

class MockElement {
  id = "";
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
