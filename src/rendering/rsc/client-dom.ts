import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { rscLogger } from "../client/browser-logger.ts";
import { RSC_ROOT_ID } from "./constants.ts";

export type SlotMessage = { type: "slot"; id: string; html: string };

export function getContainer(doc: Document, id: string): HTMLElement {
  const elementId = id === "root" ? RSC_ROOT_ID : `rsc-slot-${id}`;

  const existing = doc.getElementById(elementId);
  if (existing) return existing as HTMLElement;

  const el = doc.createElement("div");
  el.id = elementId;
  doc.body.appendChild(el);
  return el;
}

export function applySlotMessage(doc: Document, msg: SlotMessage): void {
  if (msg.type !== "slot") return;

  const el = getContainer(doc, msg.id);
  // Server-rendered RSC HTML is trusted; validateTrustedHtml provides defense-in-depth
  el.innerHTML = validateTrustedHtml(String(msg.html ?? ""));
}

export function processNdjsonChunk(doc: Document, buffered: string): string {
  const parts = buffered.split("\n");
  const remainder = parts.pop() ?? "";

  for (const line of parts) {
    const s = line.trim();
    if (!s) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch (e) {
      rscLogger.debug("[client-dom] malformed NDJSON line", {
        line: s,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    if (!parsed || typeof parsed !== "object") continue;
    const msg = parsed as SlotMessage;
    if (msg.type !== "slot") continue;

    applySlotMessage(doc, msg);
    try {
      hydrateClientBoundaries(doc, msg.id || "root");
    } catch (e) {
      rscLogger.debug("[client-dom] hydration optional failed", e);
    }
  }

  return remainder;
}

export function processNdjsonLines(doc: Document, ndjson: string): void {
  processNdjsonChunk(doc, ndjson.endsWith("\n") ? ndjson : `${ndjson}\n`);
}

function createAbortPromise(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    const abort = (): void => reject(new DOMException("aborted", "AbortError"));

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function consumeNdjsonStream(
  input: Response | ReadableStream<Uint8Array>,
  doc: Document = document,
  signal?: AbortSignal,
): Promise<void> {
  const response = "body" in input ? input : null;
  const stream = response?.body ?? (input as ReadableStream<Uint8Array>);
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamFinished = false;

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");

      const readPromise = reader.read();
      const { done, value } = signal
        ? await Promise.race([readPromise, createAbortPromise(signal)])
        : await readPromise;

      if (done) {
        streamFinished = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = processNdjsonChunk(doc, buffer);
    }

    if (buffer) processNdjsonChunk(doc, `${buffer}\n`);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    rscLogger.debug("[client-dom] consumeNdjsonStream error", e);
    throw e;
  } finally {
    try {
      await reader.cancel();
    } catch (e) {
      if (!streamFinished) rscLogger.debug("[client-dom] reader.cancel failed", e);
    }

    try {
      reader.releaseLock();
    } catch (e) {
      rscLogger.debug("[client-dom] reader.releaseLock failed", e);
    }

    if (typeof stream.cancel === "function") {
      try {
        await stream.cancel();
      } catch (e) {
        rscLogger.debug("[client-dom] stream.cancel failed", e);
      }
    }

    if (typeof response?.body?.cancel === "function") {
      try {
        await response.body.cancel();
      } catch (e) {
        rscLogger.debug("[client-dom] response.body.cancel failed", e);
      }
    }
  }
}

export function findClientBoundaries(doc: Document, slotId: string): HTMLElement[] {
  const root = getContainer(doc, slotId);
  const out: HTMLElement[] = [];

  const walker = (node: Element): void => {
    const el = node as HTMLElement;
    if (el.dataset?.clientRef) out.push(el);
    for (const child of node.children) walker(child);
  };

  walker(root);
  return out;
}

export function hydrateClientBoundaries(doc: Document, slotId: string): void {
  const nodes = findClientBoundaries(doc, slotId);

  for (const el of nodes) {
    const ref = el.dataset?.clientRef;
    if (!ref) continue;

    // Mark as seen - real hydration happens via hydrate-client.ts after streaming
    el.dataset.hydrated = "true";
    rscLogger.debug("[client-dom] marked for hydration", ref);
  }
}
