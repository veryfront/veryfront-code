import { validateTrustedHtml } from "../../security/client/html-sanitizer.ts";
import { rscLogger } from "../client/browser-logger.ts";
import { RSC_ROOT_ID } from "./constants.ts";

export type SlotMessage = { type: "slot"; id: string; html: string };

export function getContainer(doc: Document, id: string): HTMLElement {
  if (id === "root") {
    let el = doc.getElementById(RSC_ROOT_ID) as HTMLElement | null;
    if (!el) {
      el = doc.createElement("div");
      el.id = RSC_ROOT_ID;
      doc.body.appendChild(el);
    }
    return el;
  }
  const sid = `rsc-slot-${id}`;
  let el = doc.getElementById(sid) as HTMLElement | null;
  if (!el) {
    el = doc.createElement("div");
    el.id = sid;
    doc.body.appendChild(el);
  }
  return el;
}

export function applySlotMessage(doc: Document, msg: SlotMessage) {
  if (msg.type !== "slot") return;
  const el = getContainer(doc, msg.id);
  // Server-rendered RSC HTML is trusted; validateTrustedHtml provides defense-in-depth
  el.innerHTML = validateTrustedHtml(String(msg.html || ""));
}

export function processNdjsonChunk(doc: Document, buffered: string): string {
  // Split into lines; keep last fragment unprocessed
  const parts = buffered.split("\n");
  const remainder = parts.pop() ?? "";
  const queue: SlotMessage[] = [];
  for (const line of parts) {
    const s = line.trim();
    if (!s) continue;
    try {
      const msg = JSON.parse(s) as SlotMessage;
      if (msg && msg.type === "slot") queue.push(msg);
    } catch (e) {
      rscLogger.debug("[client-dom] malformed NDJSON line", {
        line: s,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  for (const msg of queue) {
    applySlotMessage(doc, msg);
    try {
      hydrateClientBoundaries(doc, msg.id || "root");
    } catch (e) {
      rscLogger.debug("[client-dom] hydration optional failed", e);
    }
  }
  return remainder;
}

export function processNdjsonLines(doc: Document, ndjson: string) {
  // Ensure trailing newline so the final line is flushed
  processNdjsonChunk(doc, ndjson.endsWith("\n") ? ndjson : `${ndjson}\n`);
}

export async function consumeNdjsonStream(
  input: Response | ReadableStream<Uint8Array>,
  doc: Document = document,
  signal?: AbortSignal,
): Promise<void> {
  const response = "body" in input ? input : null;
  const stream: ReadableStream<Uint8Array> | null = response
    ? response.body
    : (input as ReadableStream<Uint8Array>);
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamFinished = false;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");

      // Race reader.read() against abort signal
      const readPromise = reader.read();
      if (signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          const onAbort = () => {
            reject(new DOMException("aborted", "AbortError"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        });
        const { done, value } = await Promise.race([readPromise, abortPromise]);
        if (done) {
          streamFinished = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = processNdjsonChunk(doc, buffer);
      } else {
        const { done, value } = await readPromise;
        if (done) {
          streamFinished = true;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = processNdjsonChunk(doc, buffer);
      }
    }
    if (buffer) processNdjsonChunk(doc, `${buffer}\n`);
  } catch (e) {
    // If aborted, throw AbortError; otherwise rethrow
    if (e instanceof Error && e.name === "AbortError") throw e;
    rscLogger.debug("[client-dom] consumeNdjsonStream error", e);
    throw e;
  } finally {
    try {
      await reader.cancel();
    } catch (e) {
      if (!streamFinished) {
        rscLogger.debug("[client-dom] reader.cancel failed", e);
      }
    }
    try {
      reader.releaseLock();
    } catch (e) {
      rscLogger.debug("[client-dom] reader.releaseLock failed", e);
    }
    const streamCancel = (stream as ReadableStream<Uint8Array>).cancel;
    if (typeof streamCancel === "function") {
      try {
        await streamCancel.call(stream);
      } catch (e) {
        rscLogger.debug("[client-dom] stream.cancel failed", e);
      }
    }
    const responseStream = response?.body;
    if (response && responseStream) {
      const responseCancel = responseStream.cancel;
      if (typeof responseCancel === "function") {
        try {
          await responseCancel.call(responseStream);
        } catch (e) {
          rscLogger.debug("[client-dom] response.body.cancel failed", e);
        }
      }
    }
  }
}

export function findClientBoundaries(
  doc: Document,
  slotId: string,
): HTMLElement[] {
  const root = getContainer(doc, slotId);
  const out: HTMLElement[] = [];
  const walker = (node: Element) => {
    if ((node as HTMLElement).dataset?.clientRef) {
      out.push(node as HTMLElement);
    }
    for (const child of Array.from(node.children)) walker(child);
  };
  walker(root);
  return out;
}

export function hydrateClientBoundaries(doc: Document, slotId: string) {
  const nodes = findClientBoundaries(doc, slotId);
  for (const el of nodes) {
    if (!el.dataset) continue;
    const ref = el.dataset.clientRef as string;
    // Mark as seen - real hydration happens via hydrate-client.ts after streaming
    el.dataset.hydrated = "true";
    rscLogger.debug("[client-dom] marked for hydration", ref);
  }
}
