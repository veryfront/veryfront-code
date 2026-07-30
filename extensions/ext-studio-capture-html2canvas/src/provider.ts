/** html2canvas-pro adapter for the provider-neutral Studio browser contract. */

import html2canvas from "html2canvas-pro";
import type {
  StudioCaptureProvider,
  StudioCaptureRequest,
  StudioCaptureViewport,
} from "veryfront/studio/bridge";

export type Html2CanvasRenderer = (
  element: HTMLElement,
  options: Readonly<Record<string, unknown>>,
) => Promise<HTMLCanvasElement>;

const VIEWPORT_KEYS = Object.freeze(
  [
    "scale",
    "width",
    "height",
    "x",
    "y",
    "scrollX",
    "scrollY",
    "windowWidth",
    "windowHeight",
  ] as const satisfies readonly (keyof StudioCaptureViewport)[],
);

function snapshotDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }

  let descriptors: Record<string, PropertyDescriptor>;
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (isArray) throw new TypeError(`${label} must be an object`);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string") ||
    expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function snapshotCaptureRequest(value: unknown): Readonly<StudioCaptureRequest> {
  const request = snapshotDataProperties(
    value,
    ["element", "viewport", "shouldIgnoreElement", "signal"],
    "Studio capture request",
  );
  if (!request.element || typeof request.element !== "object") {
    throw new TypeError("Studio capture request element must be an object");
  }
  if (!(request.signal instanceof AbortSignal)) {
    throw new TypeError("Studio capture request signal must be an AbortSignal");
  }
  if (typeof request.shouldIgnoreElement !== "function") {
    throw new TypeError("Studio capture request shouldIgnoreElement must be a function");
  }

  const viewport = snapshotDataProperties(
    request.viewport,
    VIEWPORT_KEYS,
    "Studio capture viewport",
  );
  for (const key of VIEWPORT_KEYS) {
    const number = viewport[key];
    if (typeof number !== "number" || !Number.isFinite(number)) {
      throw new TypeError(`Studio capture viewport.${key} must be finite`);
    }
  }

  return Object.freeze({
    element: request.element as HTMLElement,
    viewport: viewport as unknown as Readonly<StudioCaptureViewport>,
    shouldIgnoreElement: request.shouldIgnoreElement as (element: Element) => boolean,
    signal: request.signal,
  });
}

/** Create a browser capture provider backed only by the pinned extension dependency. */
export function createHtml2CanvasStudioCaptureProvider(
  renderer: Html2CanvasRenderer = html2canvas,
): StudioCaptureProvider {
  if (typeof renderer !== "function") {
    throw new TypeError("html2canvas renderer must be a function");
  }
  const render = renderer;

  return async (input) => {
    const request = snapshotCaptureRequest(input);
    if (request.signal.aborted) {
      throw request.signal.reason ?? new DOMException("Studio capture aborted", "AbortError");
    }
    const viewport = request.viewport;
    const options = Object.freeze({
      useCORS: true,
      logging: false,
      ignoreElements: request.shouldIgnoreElement,
      scale: viewport.scale,
      width: viewport.width,
      height: viewport.height,
      x: viewport.x,
      y: viewport.y,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      windowWidth: viewport.windowWidth,
      windowHeight: viewport.windowHeight,
    });
    return await render(request.element, options);
  };
}
