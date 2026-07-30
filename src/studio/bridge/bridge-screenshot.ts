/**
 * Bridge Screenshot
 *
 * Provider-neutral single and multi-section screenshot capture.
 */

import { logger } from "./bridge-logger.ts";
import {
  MAX_STUDIO_SCREENSHOT_DATA_LENGTH,
  MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET,
  MAX_STUDIO_SCREENSHOT_SECTIONS,
} from "../limits.ts";
import { getStudioLocationHref } from "./bridge-location.ts";
import { DATA_STUDIO_CAPTURE_IGNORE } from "./bridge-constants.ts";

/** Browser geometry passed to an explicitly composed capture implementation. */
export interface StudioCaptureViewport {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
}

/** Input owned by core and detached before crossing the extension boundary. */
export interface StudioCaptureRequest {
  readonly element: HTMLElement;
  readonly viewport: Readonly<StudioCaptureViewport>;
  /** Core-owned policy for excluding Studio-owned elements from rendering. */
  readonly shouldIgnoreElement: (element: Element) => boolean;
  /** Aborted when the request is cancelled or exceeds its capture deadline. */
  readonly signal: AbortSignal;
}

/** Browser implementation injected by an explicitly composed Studio extension. */
export type StudioCaptureProvider = (
  request: Readonly<StudioCaptureRequest>,
) => Promise<HTMLCanvasElement>;

/** Generation-owned provider registration. */
export interface StudioCaptureProviderInstallation {
  /** Remove this provider only when this installation still owns the slot. */
  dispose(): boolean;
}

interface ScreenshotOptions {
  scrollTo?: number;
  fullPage?: boolean;
}

interface ScreenshotResult {
  success: boolean;
  data?: string;
  width?: number;
  height?: number;
  scrollY?: number;
  totalHeight?: number;
  viewportHeight?: number;
  url?: string;
  error?: string;
  section?: number;
  totalSections?: number;
}

const STUDIO_CAPTURE_TIMEOUT_MS = 15_000;
const MAX_SCREENSHOT_SECTIONS = MAX_STUDIO_SCREENSHOT_SECTIONS;
const MAX_SCROLL_OFFSET = MAX_STUDIO_SCREENSHOT_SCROLL_OFFSET;
const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 32_000_000;
const MAX_DATA_URL_LENGTH = MAX_STUDIO_SCREENSHOT_DATA_LENGTH;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const MAX_PNG_BLOB_BYTES = Math.floor(
  (MAX_DATA_URL_LENGTH - PNG_DATA_URL_PREFIX.length) * 3 / 4,
);
const MAX_DEVICE_SCALE = 2;
const LINGERING_CAPTURE_ERROR = "A timed-out screenshot capture is still running";
const CANCELLED_CAPTURE_ERROR = "Screenshot capture cancelled";
export const MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR =
  "Studio screenshot capture capability is not configured";
let installedCaptureProvider:
  | { readonly provider: StudioCaptureProvider; readonly owner: symbol }
  | null = null;
let lingeringTimedOutCapture: Promise<unknown> | null = null;

interface ScrollLease {
  window: Window;
  document: Document;
  originalX: number;
  originalY: number;
  expectedX: number;
  expectedY: number;
  changed: boolean;
  restored: boolean;
}

let activeScrollLease: ScrollLease | null = null;

function quarantineCapture(capture: Promise<unknown>): void {
  lingeringTimedOutCapture = capture;
  void capture.finally(() => {
    if (lingeringTimedOutCapture === capture) lingeringTimedOutCapture = null;
  }).catch(() => {});
}

/** Bound third-party canvas work and prevent overlap after an uncooperative timeout. */
export async function runBoundedCanvasCapture<T>(
  operation: () => Promise<T>,
  timeoutMs = STUDIO_CAPTURE_TIMEOUT_MS,
  signal?: AbortSignal,
  interruptOperation?: () => void,
): Promise<{ success: true; value: T } | { success: false; error: string }> {
  if (lingeringTimedOutCapture) {
    return { success: false, error: LINGERING_CAPTURE_ERROR };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { success: false, error: "Screenshot capture timeout is invalid" };
  }
  if (signal?.aborted) return { success: false, error: CANCELLED_CAPTURE_ERROR };

  let capture: Promise<T>;
  try {
    capture = Promise.resolve().then(operation);
  } catch {
    return { success: false, error: "Screenshot capture failed" };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener = () => {};
  const abortOutcome = signal
    ? new Promise<{ type: "cancelled" }>((resolve) => {
      const onAbort = () => resolve({ type: "cancelled" });
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    })
    : new Promise<never>(() => {});
  const outcome = await Promise.race([
    capture.then(
      (value) => ({ type: "success" as const, value }),
      () => ({ type: "failure" as const }),
    ),
    new Promise<{ type: "timeout" }>((resolve) => {
      timeout = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
    }),
    abortOutcome,
  ]);
  if (timeout) clearTimeout(timeout);
  removeAbortListener();

  if (outcome.type === "success") return { success: true, value: outcome.value };
  if (outcome.type === "failure") return { success: false, error: "Screenshot capture failed" };

  quarantineCapture(capture);
  try {
    interruptOperation?.();
  } catch {
    // The uncooperative work remains quarantined until its promise settles.
  }
  return {
    success: false,
    error: outcome.type === "cancelled" ? CANCELLED_CAPTURE_ERROR : "Screenshot capture timed out",
  };
}

/** Detach and validate screenshot options before they reach browser APIs. */
export function normalizeScreenshotOptions(value?: unknown): Readonly<ScreenshotOptions> | null {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object") return null;

  let descriptors: Record<string, PropertyDescriptor>;
  try {
    if (Array.isArray(value)) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }

  const keys = Reflect.ownKeys(descriptors);
  const allowedKeys = new Set(["scrollTo", "fullPage"]);
  if (
    keys.length > allowedKeys.size ||
    keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
  ) return null;

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) return null;
    snapshot[key] = descriptor.value;
  }

  const scrollTo = snapshot.scrollTo;
  const fullPage = snapshot.fullPage;
  if (
    scrollTo !== undefined &&
    (typeof scrollTo !== "number" || !Number.isFinite(scrollTo) || scrollTo < 0 ||
      scrollTo > MAX_SCROLL_OFFSET)
  ) return null;
  if (fullPage !== undefined && typeof fullPage !== "boolean") return null;

  return Object.freeze({
    ...(scrollTo === undefined ? {} : { scrollTo }),
    ...(fullPage === undefined ? {} : { fullPage }),
  });
}

/** Resolve a finite section count, capped to bound capture work. */
export function resolveScreenshotSectionCount(
  requested: number | undefined,
  totalHeight: number,
  viewportHeight: number,
): number | null {
  if (
    !Number.isFinite(totalHeight) || !Number.isFinite(viewportHeight) || totalHeight <= 0 ||
    viewportHeight <= 0
  ) return null;
  const naturalSections = Math.min(
    MAX_SCREENSHOT_SECTIONS,
    Math.max(1, Math.ceil(totalHeight / viewportHeight)),
  );
  if (requested !== undefined) {
    return Number.isInteger(requested) && requested >= 1 && requested <= MAX_SCREENSHOT_SECTIONS
      ? Math.min(requested, naturalSections)
      : null;
  }
  return naturalSections;
}

/** True when a canvas is within browser-safe and memory-safe bounds. */
export function isAcceptableCanvasDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= MAX_CANVAS_DIMENSION && height <= MAX_CANVAS_DIMENSION &&
    width * height <= MAX_CANVAS_PIXELS;
}

/**
 * Install one explicitly composed capture provider for this bridge generation.
 *
 * The returned compare-and-swap disposer cannot remove a later generation.
 */
export function installStudioCaptureProvider(
  provider: StudioCaptureProvider,
): StudioCaptureProviderInstallation {
  if (typeof provider !== "function") {
    throw new TypeError("Studio capture provider must be a function");
  }
  if (installedCaptureProvider) {
    throw new Error("Studio capture provider is already installed");
  }
  const owner = Symbol("veryfront.studio-capture-provider");
  installedCaptureProvider = Object.freeze({ provider, owner });

  return Object.freeze({
    dispose(): boolean {
      if (installedCaptureProvider?.owner !== owner) return false;
      installedCaptureProvider = null;
      return true;
    },
  });
}

function failure(error: string): ScreenshotResult {
  return { success: false, error };
}

function resolveScale(windowLike: Window): number {
  const ratio = windowLike.devicePixelRatio;
  return typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0
    ? Math.min(ratio, MAX_DEVICE_SCALE)
    : 1;
}

function resolveScrollOffset(
  primary: unknown,
  fallback: unknown,
  allowNegative = false,
): number {
  for (const value of [primary, fallback]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return allowNegative ? value : Math.max(0, value);
    }
  }
  return 0;
}

function currentScreenshotUrl(): string | undefined {
  return getStudioLocationHref({ includeSearch: false, includeHash: false }) || undefined;
}

const shouldIgnoreStudioCaptureElement = Object.freeze((element: Element): boolean => {
  try {
    return element.hasAttribute(DATA_STUDIO_CAPTURE_IGNORE);
  } catch {
    // Uninspectable elements are unsafe for an extension renderer to traverse.
    return true;
  }
});

type CaptureWaitOutcome = "complete" | "cancelled" | "timeout";

function captureInterruption(signal: AbortSignal | undefined, deadlineAt: number): string | null {
  if (signal?.aborted) return CANCELLED_CAPTURE_ERROR;
  return Date.now() >= deadlineAt ? "Screenshot capture timed out" : null;
}

function remainingCaptureTime(deadlineAt: number): number {
  return Math.max(0, Math.min(STUDIO_CAPTURE_TIMEOUT_MS, deadlineAt - Date.now()));
}

function waitForCaptureSettle(
  milliseconds: number,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<CaptureWaitOutcome> {
  if (signal?.aborted) return Promise.resolve("cancelled");
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return Promise.resolve("timeout");
  const delay = Math.min(milliseconds, remaining);
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => finish(Date.now() >= deadlineAt ? "timeout" : "complete"),
      delay,
    );
    const onAbort = () => finish("cancelled");
    const finish = (outcome: CaptureWaitOutcome) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function createScrollLease(windowLike: Window, documentLike: Document): ScrollLease | null {
  if (activeScrollLease) return null;
  const originalX = resolveScrollOffset(windowLike.scrollX, windowLike.pageXOffset, true);
  const originalY = resolveScrollOffset(windowLike.scrollY, windowLike.pageYOffset);
  const lease: ScrollLease = {
    window: windowLike,
    document: documentLike,
    originalX,
    originalY,
    expectedX: originalX,
    expectedY: originalY,
    changed: false,
    restored: false,
  };
  activeScrollLease = lease;
  return lease;
}

function setOwnedScroll(lease: ScrollLease, x: number, y: number): void {
  lease.window.scrollTo(x, y);
  lease.expectedX = resolveScrollOffset(
    lease.window.scrollX,
    lease.window.pageXOffset,
    true,
  );
  lease.expectedY = resolveScrollOffset(lease.window.scrollY, lease.window.pageYOffset);
  lease.changed = true;
}

function restoreOwnedScroll(lease: ScrollLease): void {
  if (lease.restored) return;
  lease.restored = true;
  if (activeScrollLease === lease) activeScrollLease = null;
  if (!lease.changed) return;
  if (globalThis.window !== lease.window || globalThis.document !== lease.document) return;
  const currentX = resolveScrollOffset(lease.window.scrollX, lease.window.pageXOffset, true);
  const currentY = resolveScrollOffset(lease.window.scrollY, lease.window.pageYOffset);
  if (currentX !== lease.expectedX || currentY !== lease.expectedY) return;
  lease.window.scrollTo(lease.originalX, lease.originalY);
}

function encodeCanvasAsPng(canvas: HTMLCanvasElement, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let reader: FileReader | null = null;
    let settled = false;
    let toBlobStarted = false;
    let blobCallbackReceived = false;
    let interrupted = signal.aborted;
    const detach = () => {
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // Cleanup must not prevent encoder settlement.
      }
      if (!reader) return;
      try {
        reader.onload = null;
      } catch {
        // Cleanup must not prevent encoder settlement.
      }
      try {
        reader.onerror = null;
      } catch {
        // Cleanup must not prevent encoder settlement.
      }
      try {
        reader.onabort = null;
      } catch {
        // Cleanup must not prevent encoder settlement.
      }
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      detach();
      reject(new Error("Screenshot encoding failed"));
    };
    const succeed = (dataUrl: string) => {
      if (settled) return;
      settled = true;
      detach();
      resolve(dataUrl);
    };
    const onAbort = () => {
      if (settled) return;
      interrupted = true;
      if (!toBlobStarted) {
        fail();
        return;
      }
      // Canvas toBlob has no cancellation API. While it is pending, leave the
      // promise unsettled so the outer quarantine continues to prevent
      // overlapping native encodes. FileReader does have an abort API.
      if (!reader) return;
      const activeReader = reader;
      try {
        activeReader.abort();
      } catch {
        // Settle below even when a page-owned FileReader facade throws.
      }
      fail();
    };

    if (interrupted) {
      fail();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (typeof canvas.toBlob !== "function") {
        fail();
        return;
      }
      toBlobStarted = true;
      canvas.toBlob((blob) => {
        try {
          if (blobCallbackReceived || settled) return;
          blobCallbackReceived = true;
          if (interrupted) {
            fail();
            return;
          }
          if (!blob || blob.type !== "image/png" || blob.size > MAX_PNG_BLOB_BYTES) {
            fail();
            return;
          }
          reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader?.result;
            if (
              typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX) ||
              dataUrl.length < 100 || dataUrl.length > MAX_DATA_URL_LENGTH
            ) {
              fail();
              return;
            }
            succeed(dataUrl);
          };
          reader.onerror = fail;
          reader.onabort = fail;
          reader.readAsDataURL(blob);
        } catch {
          fail();
        }
      }, "image/png");
    } catch {
      fail();
    }
  });
}

export async function captureScreenshot(
  options?: ScreenshotOptions,
  signal?: AbortSignal,
  deadlineAt = Date.now() + STUDIO_CAPTURE_TIMEOUT_MS,
): Promise<ScreenshotResult> {
  const normalized = normalizeScreenshotOptions(options);
  if (!normalized) return failure("Invalid screenshot options");
  if (lingeringTimedOutCapture) return failure(LINGERING_CAPTURE_ERROR);
  const captureProvider = installedCaptureProvider?.provider;
  if (!captureProvider) return failure(MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR);
  const initialInterruption = captureInterruption(signal, deadlineAt);
  if (initialInterruption) return failure(initialInterruption);

  const capturedWindow = globalThis.window;
  const capturedDocument = globalThis.document;
  const lease = createScrollLease(capturedWindow, capturedDocument);
  if (!lease) return failure("Screenshot capture is already in progress");
  const onAbort = () => restoreOwnedScroll(lease);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let viewportScrollY = lease.originalY;
    if (normalized.scrollTo !== undefined) {
      setOwnedScroll(lease, lease.originalX, normalized.scrollTo);
      const wait = await waitForCaptureSettle(150, deadlineAt, signal);
      if (wait !== "complete") {
        return failure(
          wait === "cancelled" ? CANCELLED_CAPTURE_ERROR : "Screenshot capture timed out",
        );
      }
      viewportScrollY = resolveScrollOffset(capturedWindow.scrollY, capturedWindow.pageYOffset);
    }

    const beforeGeometryInterruption = captureInterruption(signal, deadlineAt);
    if (beforeGeometryInterruption) return failure(beforeGeometryInterruption);
    const scale = resolveScale(capturedWindow);
    const documentElement = capturedDocument.documentElement;
    const totalHeight = documentElement.scrollHeight;
    const viewportHeight = capturedWindow.innerHeight;
    const captureWidth = normalized.fullPage
      ? Math.max(
        documentElement.scrollWidth,
        capturedDocument.body.scrollWidth,
        capturedWindow.innerWidth,
      )
      : capturedWindow.innerWidth;
    const captureHeight = normalized.fullPage ? totalHeight : viewportHeight;
    const captureX = normalized.fullPage ? 0 : lease.originalX;
    const captureY = normalized.fullPage ? 0 : viewportScrollY;
    if (
      !Number.isFinite(totalHeight) || totalHeight < 0 || totalHeight > MAX_SCROLL_OFFSET ||
      !Number.isFinite(viewportHeight) || viewportHeight <= 0 ||
      viewportHeight > MAX_SCROLL_OFFSET || !Number.isFinite(captureWidth) ||
      !Number.isFinite(captureHeight) || Math.abs(captureX) > MAX_SCROLL_OFFSET ||
      captureY > MAX_SCROLL_OFFSET ||
      !isAcceptableCanvasDimensions(
        Math.ceil(captureWidth * scale),
        Math.ceil(captureHeight * scale),
      )
    ) return failure("Screenshot dimensions exceed the capture limit");

    const viewport = Object.freeze(
      {
        scale,
        width: captureWidth,
        height: captureHeight,
        x: captureX,
        y: captureY,
        scrollX: captureX,
        scrollY: captureY,
        windowWidth: captureWidth,
        windowHeight: captureHeight,
      } satisfies StudioCaptureViewport,
    );

    if (normalized.fullPage) {
      setOwnedScroll(lease, 0, 0);
      const wait = await waitForCaptureSettle(100, deadlineAt, signal);
      if (wait !== "complete") {
        return failure(
          wait === "cancelled" ? CANCELLED_CAPTURE_ERROR : "Screenshot capture timed out",
        );
      }
    }

    const beforeRenderInterruption = captureInterruption(signal, deadlineAt);
    if (beforeRenderInterruption) return failure(beforeRenderInterruption);
    const renderTime = remainingCaptureTime(deadlineAt);
    if (renderTime <= 0) return failure("Screenshot capture timed out");
    const renderController = new AbortController();
    const request = Object.freeze(
      {
        element: capturedDocument.body,
        viewport,
        shouldIgnoreElement: shouldIgnoreStudioCaptureElement,
        signal: renderController.signal,
      } satisfies StudioCaptureRequest,
    );
    const capture = await runBoundedCanvasCapture(
      () => captureProvider(request),
      renderTime,
      signal,
      () => renderController.abort(),
    );
    if (!capture.success) return failure(capture.error);
    const canvas = capture.value;
    if (!canvas || !isAcceptableCanvasDimensions(canvas.width, canvas.height)) {
      logger.error("Studio capture provider produced invalid or oversized canvas dimensions");
      return failure("Screenshot canvas dimensions are invalid or too large");
    }

    const beforeEncodingInterruption = captureInterruption(signal, deadlineAt);
    if (beforeEncodingInterruption) return failure(beforeEncodingInterruption);
    const encodingTime = remainingCaptureTime(deadlineAt);
    if (encodingTime <= 0) return failure("Screenshot capture timed out");
    const encodingController = new AbortController();
    const encoding = await runBoundedCanvasCapture(
      () => encodeCanvasAsPng(canvas, encodingController.signal),
      encodingTime,
      signal,
      () => encodingController.abort(),
    );
    if (!encoding.success) {
      logger.error("Studio capture provider produced invalid or oversized image data");
      return failure(encoding.error);
    }
    const dataUrl = encoding.value;

    const beforeResultInterruption = captureInterruption(signal, deadlineAt);
    if (beforeResultInterruption) return failure(beforeResultInterruption);
    const url = currentScreenshotUrl();
    return {
      success: true,
      data: dataUrl,
      width: canvas.width,
      height: canvas.height,
      scrollY: captureY,
      totalHeight,
      viewportHeight,
      ...(url ? { url } : {}),
    };
  } catch {
    const interruption = captureInterruption(signal, deadlineAt);
    if (interruption) return failure(interruption);
    logger.error("Screenshot capture failed");
    return failure("Screenshot capture failed");
  } finally {
    signal?.removeEventListener("abort", onAbort);
    restoreOwnedScroll(lease);
  }
}

export async function captureMultipleSections(
  sectionCount?: number,
  signal?: AbortSignal,
  deadlineAt = Date.now() + STUDIO_CAPTURE_TIMEOUT_MS,
): Promise<ScreenshotResult[]> {
  if (!installedCaptureProvider) return [failure(MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR)];
  const initialInterruption = captureInterruption(signal, deadlineAt);
  if (initialInterruption) return [failure(initialInterruption)];
  const capturedWindow = globalThis.window;
  const capturedDocument = globalThis.document;
  const results: ScreenshotResult[] = [];
  const totalHeight = capturedDocument.documentElement.scrollHeight;
  const viewportHeight = capturedWindow.innerHeight;
  const sections = resolveScreenshotSectionCount(sectionCount, totalHeight, viewportHeight);
  let capturedDataLength = 0;
  if (sections === null) {
    logger.warn("Screenshot section geometry is invalid or exceeds the capture limit");
    return [failure("Screenshot section geometry is invalid or exceeds the capture limit")];
  }

  for (let index = 0; index < sections; index++) {
    const interruption = captureInterruption(signal, deadlineAt);
    if (interruption) {
      results.push(failure(interruption));
      break;
    }
    const scrollY = Math.max(
      0,
      Math.min(index * viewportHeight, Math.max(0, totalHeight - viewportHeight)),
    );
    const result = await captureScreenshot({ scrollTo: scrollY }, signal, deadlineAt);
    const dataLength = result.data?.length ?? 0;
    if (capturedDataLength + dataLength > MAX_DATA_URL_LENGTH) {
      results.push({
        success: false,
        error: "Combined screenshot data exceeds the capture limit",
        section: index + 1,
        totalSections: sections,
      });
      break;
    }
    capturedDataLength += dataLength;
    results.push({ ...result, section: index + 1, totalSections: sections });
    if (!result.success) break;
  }

  return results;
}
