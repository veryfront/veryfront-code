import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureMultipleSections,
  captureScreenshot,
  isAcceptableCanvasDimensions,
  normalizeScreenshotOptions,
  resolveScreenshotSectionCount,
  runBoundedCanvasCapture,
} from "./bridge-screenshot.ts";
import { state } from "./bridge-state.ts";
import { setConfigForTest } from "./bridge-config.ts";

describe("studio/bridge/bridge-screenshot", () => {
  it("normalizes a bounded detached options snapshot", () => {
    const input = { scrollTo: 120, fullPage: true };
    const result = normalizeScreenshotOptions(input);
    input.scrollTo = 999;

    assertEquals(result, { scrollTo: 120, fullPage: true });
  });

  it("rejects invalid screenshot values", () => {
    assertEquals(normalizeScreenshotOptions({ scrollTo: Infinity }), null);
    assertEquals(normalizeScreenshotOptions({ scrollTo: -1 }), null);
    assertEquals(normalizeScreenshotOptions({ quality: 0.8 }), null);
    assertEquals(normalizeScreenshotOptions({ fullPage: "true" as unknown as boolean }), null);
    assertEquals(
      normalizeScreenshotOptions({ fullPage: true, extra: true } as never),
      null,
    );
  });

  it("rejects option accessors without executing them", () => {
    let getterCalls = 0;
    const input = Object.defineProperty({}, "scrollTo", {
      enumerable: true,
      get() {
        getterCalls++;
        return 10;
      },
    });

    assertEquals(normalizeScreenshotOptions(input), null);
    assertEquals(getterCalls, 0);
  });

  it("contains revoked option proxies", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    assertEquals(normalizeScreenshotOptions(proxy), null);
  });

  it("bounds explicit and derived section counts", () => {
    assertEquals(resolveScreenshotSectionCount(3, 3_000, 1_000), 3);
    assertEquals(resolveScreenshotSectionCount(20, 3_000, 1_000), 3);
    assertEquals(resolveScreenshotSectionCount(undefined, 5_000, 1_000), 5);
    assertEquals(resolveScreenshotSectionCount(undefined, 100_000, 1_000), 20);
    assertEquals(resolveScreenshotSectionCount(21, 5_000, 1_000), null);
    assertEquals(resolveScreenshotSectionCount(Infinity, 5_000, 1_000), null);
    assertEquals(resolveScreenshotSectionCount(undefined, 5_000, 0), null);
  });

  it("rejects empty, non-finite, and oversized canvases", () => {
    assertEquals(isAcceptableCanvasDimensions(1_000, 1_000), true);
    assertEquals(isAcceptableCanvasDimensions(0, 1_000), false);
    assertEquals(isAcceptableCanvasDimensions(Infinity, 1_000), false);
    assertEquals(isAcceptableCanvasDimensions(8_000, 8_000), false);
  });

  it("times out a hung canvas and quarantines it until the work settles", async () => {
    let release: ((value: string) => void) | undefined;
    const timedOut = await runBoundedCanvasCapture(
      () => new Promise<string>((resolve) => (release = resolve)),
      1,
    );

    assertEquals(timedOut, { success: false, error: "Screenshot capture timed out" });
    assertEquals(await runBoundedCanvasCapture(() => Promise.resolve("overlap"), 1), {
      success: false,
      error: "A timed-out screenshot capture is still running",
    });

    const originalWindow = globalThis.window;
    const scrollCalls: number[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        scrollY: 0,
        scrollTo(_x: number, y: number) {
          scrollCalls.push(y);
        },
      },
    });
    try {
      assertEquals(await captureScreenshot({ scrollTo: 123 }), {
        success: false,
        error: "A timed-out screenshot capture is still running",
      });
      assertEquals(scrollCalls, []);
    } finally {
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    }

    release?.("late");
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(await runBoundedCanvasCapture(() => Promise.resolve("next"), 1), {
      success: true,
      value: "next",
    });
  });

  it("cancels settle work and restores bridge-owned scroll immediately", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let scrollX = 7;
    let scrollY = 11;
    let renderCalls = 0;
    let resolveBridgeScroll: (() => void) | undefined;
    const bridgeScrolled = new Promise<void>((resolve) => (resolveBridgeScroll = resolve));
    const fakeWindow = {
      get scrollX() {
        return scrollX;
      },
      get scrollY() {
        return scrollY;
      },
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 1,
      location: { href: "https://preview.example/page" },
      scrollTo(x: number, y: number) {
        scrollX = x;
        scrollY = y;
        if (y === 200) resolveBridgeScroll?.();
      },
    } as unknown as Window;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 2_000, scrollWidth: 1_000 },
    } as unknown as Document;
    state.html2canvasLoaded = true;
    state.html2canvasPromise = null;
    state.html2canvasImplementation = async () => {
      renderCalls++;
      return {} as HTMLCanvasElement;
    };
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    const controller = new AbortController();

    try {
      const capture = captureScreenshot({ scrollTo: 200 }, controller.signal);
      await bridgeScrolled;
      assertEquals([scrollX, scrollY], [7, 200]);

      controller.abort();
      const scrollImmediatelyAfterAbort = [scrollX, scrollY];
      const result = await capture;

      assertEquals(scrollImmediatelyAfterAbort, [7, 11]);
      assertEquals(result, {
        success: false,
        error: "Screenshot capture cancelled",
      });
      assertEquals(renderCalls, 0);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      state.html2canvasImplementation = null;
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("uses one absolute deadline across settle, render, and encode stages", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let scrollY = 0;
    let renderCalls = 0;
    const fakeWindow = {
      scrollX: 0,
      get scrollY() {
        return scrollY;
      },
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 1,
      location: { href: "https://preview.example/page" },
      scrollTo(_x: number, y: number) {
        scrollY = y;
      },
    } as unknown as Window;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 2_000, scrollWidth: 1_000 },
    } as unknown as Document;
    state.html2canvasLoaded = true;
    state.html2canvasPromise = null;
    state.html2canvasImplementation = async () => {
      renderCalls++;
      return {} as HTMLCanvasElement;
    };
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });

    try {
      const captureWithDeadline = captureScreenshot as unknown as (
        options: { scrollTo: number },
        signal: AbortSignal | undefined,
        deadlineAt: number,
      ) => Promise<{ success: boolean; error?: string }>;
      assertEquals(await captureWithDeadline({ scrollTo: 100 }, undefined, Date.now() + 1), {
        success: false,
        error: "Screenshot capture timed out",
      });
      assertEquals(renderCalls, 0);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      state.html2canvasImplementation = null;
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("uses only verified screenshot support and asynchronous PNG encoding", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let canvasOptions: Record<string, unknown> | undefined;
    let appendedScript: Record<string, unknown> | undefined;
    let appendCalls = 0;
    let ambientCalls = 0;
    let verifiedCalls = 0;
    let fakeScrollY = 25;
    let maximumScrollY = Infinity;
    const serializationCalls: unknown[][] = [];
    const fakeWindow = {
      get scrollY() {
        return fakeScrollY;
      },
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 4,
      location: { href: "https://preview.example/page?token=<TOKEN>#private" },
      scrollTo(_x: number, y: number) {
        fakeScrollY = Math.min(y, maximumScrollY);
      },
    } as unknown as Window & Record<string, unknown>;
    const canvas = {
      width: 2_000,
      height: 1_600,
      toBlob(callback: BlobCallback, ...args: unknown[]) {
        serializationCalls.push(args);
        callback(new Blob(["a".repeat(100)], { type: "image/png" }));
      },
      toDataURL() {
        throw new Error("synchronous PNG encoding must not run");
      },
    } as unknown as HTMLCanvasElement;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 2_000, scrollWidth: 1_000 },
      head: {
        appendChild(script: Record<string, unknown>) {
          appendCalls++;
          appendedScript = script;
          fakeWindow.html2canvas = (
            _element: HTMLElement,
            options?: Record<string, unknown>,
          ) => {
            verifiedCalls++;
            canvasOptions = options;
            return Promise.resolve(canvas);
          };
          (script.onload as (() => void) | null)?.();
        },
      },
      createElement() {
        return {
          src: "",
          integrity: "",
          crossOrigin: "",
          referrerPolicy: "",
          onload: null,
          onerror: null,
          remove() {
            throw new Error("page-owned remove hook failed");
          },
        };
      },
    } as unknown as Document;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    setConfigForTest({ nonce: "request-nonce" });
    state.html2canvasLoaded = false;
    state.html2canvasPromise = null;
    (state as typeof state & { html2canvasImplementation?: unknown }).html2canvasImplementation =
      null;
    const ambientImplementation = () => {
      ambientCalls++;
      return Promise.resolve(canvas);
    };
    fakeWindow.html2canvas = ambientImplementation;
    try {
      const result = await captureScreenshot();

      assertEquals(result.success, true);
      assertEquals(ambientCalls, 0);
      assertEquals(verifiedCalls, 1);
      assertEquals(appendCalls, 1);
      assertEquals(fakeWindow.html2canvas, ambientImplementation);
      assertEquals(canvasOptions?.scale, 2);
      assertEquals(canvasOptions?.width, 1_000);
      assertEquals(canvasOptions?.height, 800);
      assertEquals(canvasOptions?.x, 0);
      assertEquals(canvasOptions?.y, 25);
      assertEquals(canvasOptions?.scrollX, 0);
      assertEquals(canvasOptions?.scrollY, 25);
      assertEquals(canvasOptions?.windowWidth, 1_000);
      assertEquals(canvasOptions?.windowHeight, 800);
      assertEquals(fakeWindow.scrollY, 25);
      assertEquals(result.url, "https://preview.example/page");
      assertEquals(serializationCalls, [["image/png"]]);
      assertEquals(
        appendedScript?.integrity,
        "sha384-K5+auTotBhvOwLRTG+bE2EYOQYuC9FnNbLXkGE0aRgUdau5Z59G6gTJTKpqqBrnv",
      );
      assertEquals(appendedScript?.crossOrigin, "anonymous");
      assertEquals(appendedScript?.nonce, "request-nonce");

      maximumScrollY = 500;
      const clamped = await captureScreenshot({ scrollTo: 900 });
      assertEquals(clamped.scrollY, 500);
      assertEquals(canvasOptions?.y, 500);
      assertEquals(canvasOptions?.scrollY, 500);

      maximumScrollY = Infinity;
      const fullPage = await captureScreenshot({ fullPage: true });
      assertEquals(fullPage.success, true);
      assertEquals(canvasOptions?.width, 1_000);
      assertEquals(canvasOptions?.height, 2_000);
      assertEquals(canvasOptions?.x, 0);
      assertEquals(canvasOptions?.y, 0);
      assertEquals(canvasOptions?.scrollX, 0);
      assertEquals(canvasOptions?.scrollY, 0);
      assertEquals(canvasOptions?.windowWidth, 1_000);
      assertEquals(canvasOptions?.windowHeight, 2_000);
      assertEquals(serializationCalls.at(-1), ["image/png"]);

      fakeWindow.html2canvas = () => {
        ambientCalls++;
        return Promise.resolve(canvas);
      };
      assertEquals((await captureScreenshot()).success, true);
      assertEquals(ambientCalls, 0);
      assertEquals(verifiedCalls, 4);
      assertEquals(appendCalls, 1);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      (state as typeof state & { html2canvasImplementation?: unknown }).html2canvasImplementation =
        null;
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("restores both scroll axes after a multi-section capture", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let scrollX = -37;
    let scrollY = 25;
    const scrollCalls: Array<[number, number]> = [];
    const canvas = {
      width: 1_000,
      height: 800,
      toBlob(callback: BlobCallback) {
        callback(new Blob(["a".repeat(100)], { type: "image/png" }));
      },
    } as unknown as HTMLCanvasElement;
    const html2canvasImplementation = () => Promise.resolve(canvas);
    const fakeWindow = {
      get scrollX() {
        return scrollX;
      },
      get scrollY() {
        return scrollY;
      },
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 1,
      location: { href: "https://preview.example/page" },
      html2canvas: html2canvasImplementation,
      scrollTo(x: number, y: number) {
        scrollX = x;
        scrollY = y;
        scrollCalls.push([x, y]);
      },
    } as unknown as Window;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 800, scrollWidth: 1_000 },
    } as unknown as Document;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    state.html2canvasLoaded = true;
    state.html2canvasPromise = null;
    state.html2canvasImplementation = html2canvasImplementation;
    try {
      const results = await captureMultipleSections(1);

      assertEquals(results[0]?.success, true);
      assertEquals(scrollCalls.at(-1), [-37, 25]);
      assertEquals([scrollX, scrollY], [-37, 25]);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      state.html2canvasImplementation = null;
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("clears a failed loader so a later capture can retry", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let appendCalls = 0;
    const fakeWindow = {
      scrollY: 0,
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 1,
      location: { href: "https://preview.example/page" },
      scrollTo() {},
    } as unknown as Window;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 2_000, scrollWidth: 1_000 },
      head: {
        appendChild(script: { onerror: (() => void) | null }) {
          appendCalls++;
          script.onerror?.();
        },
      },
      createElement() {
        return {
          onload: null,
          onerror: null,
          remove() {
            throw new Error("page-owned remove hook failed");
          },
        };
      },
    } as unknown as Document;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    state.html2canvasLoaded = false;
    state.html2canvasPromise = null;
    state.html2canvasImplementation = null;
    try {
      assertEquals((await captureScreenshot()).success, false);
      assertEquals((await captureScreenshot()).success, false);
      assertEquals(appendCalls, 2);
      assertEquals(Object.hasOwn(fakeWindow, "html2canvas"), false);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      state.html2canvasImplementation = null;
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("aborts an active PNG reader on timeout and releases encoder ownership", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFileReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
    let readerAbortCalls = 0;
    let readerReadCalls = 0;
    const dataUrl = "data:image/png;base64," + "a".repeat(100);

    class HungFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL(): void {
        readerReadCalls++;
      }

      abort(): void {
        readerAbortCalls++;
        this.onabort?.({} as ProgressEvent<FileReader>);
      }
    }

    class SuccessfulFileReader extends HungFileReader {
      override readAsDataURL(): void {
        readerReadCalls++;
        this.result = dataUrl;
        this.onload?.({} as ProgressEvent<FileReader>);
      }
    }

    const canvas = {
      width: 1_000,
      height: 800,
      toBlob(callback: BlobCallback) {
        callback(new Blob(["a".repeat(100)], { type: "image/png" }));
      },
    } as unknown as HTMLCanvasElement;
    const fakeWindow = {
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 1,
      location: { href: "https://preview.example/page" },
      scrollTo() {},
    } as unknown as Window;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 800, scrollWidth: 1_000 },
    } as unknown as Document;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    Object.defineProperty(globalThis, "FileReader", {
      value: HungFileReader,
      configurable: true,
    });
    state.html2canvasLoaded = true;
    state.html2canvasPromise = null;
    state.html2canvasImplementation = () => Promise.resolve(canvas);

    try {
      const timedOut = await captureScreenshot(undefined, undefined, Date.now() + 20);
      assertEquals(timedOut, { success: false, error: "Screenshot capture timed out" });
      assertEquals(readerReadCalls, 1);
      assertEquals(readerAbortCalls, 1);

      Object.defineProperty(globalThis, "FileReader", {
        value: SuccessfulFileReader,
        configurable: true,
      });
      assertEquals((await captureScreenshot()).success, true);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      state.html2canvasImplementation = null;
      if (originalFileReader) {
        Object.defineProperty(globalThis, "FileReader", originalFileReader);
      } else {
        Reflect.deleteProperty(globalThis, "FileReader");
      }
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("quarantines an uninterruptible toBlob call and ignores its late callback", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFileReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
    let pendingBlobCallback: BlobCallback | undefined;
    let completeImmediately = false;
    let readerCalls = 0;
    const blob = new Blob(["a".repeat(100)], { type: "image/png" });

    class SuccessfulFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsDataURL(): void {
        readerCalls++;
        this.result = "data:image/png;base64," + "a".repeat(100);
        this.onload?.({} as ProgressEvent<FileReader>);
      }

      abort(): void {
        this.onabort?.({} as ProgressEvent<FileReader>);
      }
    }

    const canvas = {
      width: 1_000,
      height: 800,
      toBlob(callback: BlobCallback) {
        if (completeImmediately) callback(blob);
        else pendingBlobCallback = callback;
      },
    } as unknown as HTMLCanvasElement;
    const fakeWindow = {
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1_000,
      innerHeight: 800,
      devicePixelRatio: 1,
      location: { href: "https://preview.example/page" },
      scrollTo() {},
    } as unknown as Window;
    const fakeDocument = {
      body: { scrollWidth: 1_000 },
      documentElement: { scrollHeight: 800, scrollWidth: 1_000 },
    } as unknown as Document;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    Object.defineProperty(globalThis, "FileReader", {
      value: SuccessfulFileReader,
      configurable: true,
    });
    state.html2canvasLoaded = true;
    state.html2canvasPromise = null;
    state.html2canvasImplementation = () => Promise.resolve(canvas);

    try {
      assertEquals(
        await captureScreenshot(undefined, undefined, Date.now() + 20),
        { success: false, error: "Screenshot capture timed out" },
      );
      assertEquals(readerCalls, 0);
      assertEquals(await captureScreenshot(), {
        success: false,
        error: "A timed-out screenshot capture is still running",
      });

      pendingBlobCallback?.(blob);
      pendingBlobCallback?.(blob);
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(readerCalls, 0);

      completeImmediately = true;
      assertEquals((await captureScreenshot()).success, true);
      assertEquals(readerCalls, 1);
    } finally {
      state.html2canvasLoaded = false;
      state.html2canvasPromise = null;
      state.html2canvasImplementation = null;
      if (originalFileReader) {
        Object.defineProperty(globalThis, "FileReader", originalFileReader);
      } else {
        Reflect.deleteProperty(globalThis, "FileReader");
      }
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });
});
