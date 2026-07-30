import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import { createHtml2CanvasStudioCaptureProvider, type Html2CanvasRenderer } from "./provider.ts";

const viewport = Object.freeze({
  scale: 2,
  width: 1_000,
  height: 800,
  x: 12,
  y: 34,
  scrollX: 12,
  scrollY: 34,
  windowWidth: 1_000,
  windowHeight: 800,
});
const ignoredElement = {} as Element;
const shouldIgnoreElement = (element: Element): boolean => element === ignoredElement;

Deno.test("html2canvas Studio adapter maps only the neutral capture contract", async () => {
  const element = {} as HTMLElement;
  const canvas = {} as HTMLCanvasElement;
  let capturedElement: HTMLElement | undefined;
  let capturedOptions: Readonly<Record<string, unknown>> | undefined;
  const renderer: Html2CanvasRenderer = (renderedElement, options) => {
    capturedElement = renderedElement;
    capturedOptions = options;
    return Promise.resolve(canvas);
  };
  const provider = createHtml2CanvasStudioCaptureProvider(renderer);
  const controller = new AbortController();

  assertStrictEquals(
    await provider(
      Object.freeze({ element, viewport, shouldIgnoreElement, signal: controller.signal }),
    ),
    canvas,
  );
  assertStrictEquals(capturedElement, element);
  assertEquals(Object.isFrozen(capturedOptions), true);
  assertEquals({ ...capturedOptions, ignoreElements: undefined }, {
    useCORS: true,
    logging: false,
    ignoreElements: undefined,
    scale: 2,
    width: 1_000,
    height: 800,
    x: 12,
    y: 34,
    scrollX: 12,
    scrollY: 34,
    windowWidth: 1_000,
    windowHeight: 800,
  });
  const ignoreElements = capturedOptions?.ignoreElements as
    | ((candidate: Element) => boolean)
    | undefined;
  assertStrictEquals(ignoreElements, shouldIgnoreElement);
  assertEquals(ignoreElements?.(ignoredElement), true);
  assertEquals(ignoreElements?.({} as Element), false);
});

Deno.test("html2canvas Studio adapter rejects hostile requests without invoking accessors", async () => {
  let getterCalls = 0;
  let rendererCalls = 0;
  const provider = createHtml2CanvasStudioCaptureProvider(() => {
    rendererCalls++;
    return Promise.resolve({} as HTMLCanvasElement);
  });
  const accessor = Object.defineProperty({}, "element", {
    enumerable: true,
    get() {
      getterCalls++;
      return {};
    },
  });

  await assertRejects(
    () => provider(accessor as never),
    TypeError,
    "invalid shape",
  );
  assertEquals(getterCalls, 0);
  assertEquals(rendererCalls, 0);

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  await assertRejects(
    () => provider(proxy as never),
    TypeError,
    "could not be inspected",
  );
  assertEquals(rendererCalls, 0);
});

Deno.test("html2canvas Studio adapter fails before rendering an aborted request", async () => {
  let rendererCalls = 0;
  const provider = createHtml2CanvasStudioCaptureProvider(() => {
    rendererCalls++;
    return Promise.resolve({} as HTMLCanvasElement);
  });
  const controller = new AbortController();
  const reason = new DOMException("capture retired", "AbortError");
  controller.abort(reason);

  assertStrictEquals(
    await assertRejects(() =>
      provider({
        element: {} as HTMLElement,
        viewport,
        shouldIgnoreElement,
        signal: controller.signal,
      })
    ),
    reason,
  );
  assertEquals(rendererCalls, 0);
});

Deno.test("html2canvas Studio adapter validates renderer and viewport", async () => {
  assertThrows(
    () => createHtml2CanvasStudioCaptureProvider(null as never),
    TypeError,
    "renderer must be a function",
  );
  const provider = createHtml2CanvasStudioCaptureProvider(() =>
    Promise.resolve({} as HTMLCanvasElement)
  );
  await assertRejects(
    () =>
      provider({
        element: {} as HTMLElement,
        viewport: { ...viewport, scale: Number.NaN },
        shouldIgnoreElement,
        signal: new AbortController().signal,
      }),
    TypeError,
    "viewport.scale must be finite",
  );
  await assertRejects(
    () =>
      provider({
        element: {} as HTMLElement,
        viewport,
        shouldIgnoreElement: null as never,
        signal: new AbortController().signal,
      }),
    TypeError,
    "shouldIgnoreElement must be a function",
  );
});
