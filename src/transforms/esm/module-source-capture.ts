import { BUILD_FAILED } from "#veryfront/errors";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import type { RenderArtifactLimits } from "./render-artifacts.ts";
import type { RenderModuleSnapshot } from "./link-render-modules.ts";

/**
 * Retain bounded, consistent source bytes at an existing authorized read seam.
 *
 * Producers supply canonical file URLs; this owner performs no IO. Recording
 * failure invalidates only this capture, never a shared fetch serving other
 * callers. take() reports that failure at the requesting caller's boundary.
 * Both take() and discard() close the owner and release its retained sources,
 * so late shared work cannot refill it after the request finishes or aborts.
 */
export class ModuleSourceCapture {
  readonly #sources = new Map<string, string>();
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  #bytes = 0;
  #failure?: string;
  #closed = false;

  constructor(limits: RenderArtifactLimits) {
    const { maxEntries, maxBytes } = limits;
    if (
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1
    ) throw new RangeError("Module capture budgets must be positive safe integers");
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
  }

  record(url: string, source: string): void {
    if (this.#closed || this.#failure) return;
    const previous = this.#sources.get(url);
    if (previous !== undefined) {
      if (previous !== source) this.#fail("Module source changed during capture");
      return;
    }
    if (this.#sources.size >= this.#maxEntries) {
      this.#fail("Module capture exceeds its entry budget");
      return;
    }
    for (const text of [url, source]) {
      this.#bytes += utf8ByteLength(text, this.#maxBytes - this.#bytes);
      if (this.#bytes > this.#maxBytes) {
        this.#fail("Module capture exceeds its byte budget");
        return;
      }
      if (!isWellFormedString(text)) {
        this.#fail("Module capture requires lossless UTF-8 text");
        return;
      }
    }
    this.#sources.set(url, source);
  }

  #fail(detail: string): void {
    this.#failure = detail;
    this.#sources.clear();
  }

  /** Mark a producer's incomplete result without throwing into shared work. */
  invalidate(): void {
    if (!this.#closed && !this.#failure) this.#fail("Module capture is incomplete");
  }

  take(): RenderModuleSnapshot["modules"] {
    if (this.#closed) throw BUILD_FAILED.create({ detail: "Module capture is closed" });
    try {
      if (this.#failure) throw BUILD_FAILED.create({ detail: this.#failure });
      return Object.freeze(
        [...this.#sources].map(([url, source]) => Object.freeze({ url, source })),
      );
    } finally {
      this.discard();
    }
  }

  discard(): void {
    this.#closed = true;
    this.#sources.clear();
  }
}
