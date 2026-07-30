import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureMultipleSections,
  captureScreenshot,
  installStudioCaptureProvider,
  isAcceptableCanvasDimensions,
  MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR,
  normalizeScreenshotOptions,
  resolveScreenshotSectionCount,
  runBoundedCanvasCapture,
} from "./bridge-screenshot.ts";

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

  it("fails closed before touching browser state when capture is not composed", async () => {
    const originalWindow = globalThis.window;
    let windowReads = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        windowReads++;
        throw new Error("window must not be read");
      },
    });
    try {
      assertEquals(await captureScreenshot(), {
        success: false,
        error: MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR,
      });
      assertEquals(await captureMultipleSections(), [{
        success: false,
        error: MISSING_STUDIO_CAPTURE_CAPABILITY_ERROR,
      }]);
      assertEquals(windowReads, 0);
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      });
    }
  });

  it("owns provider registration with compare-and-swap disposal", () => {
    const firstProvider = () => Promise.resolve({} as HTMLCanvasElement);
    const installation = installStudioCaptureProvider(firstProvider);
    try {
      let threw = false;
      try {
        installStudioCaptureProvider(() => Promise.resolve({} as HTMLCanvasElement));
      } catch (error) {
        threw = error instanceof Error && error.message.includes("already installed");
      }
      assertEquals(threw, true);
      assertEquals(installation.dispose(), true);
      assertEquals(installation.dispose(), false);
      const replacement = installStudioCaptureProvider(firstProvider);
      assertEquals(installation.dispose(), false);
      assertEquals(replacement.dispose(), true);
    } finally {
      installation.dispose();
    }
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
    const providerInstallation = installStudioCaptureProvider(async () => {
      renderCalls++;
      return {} as HTMLCanvasElement;
    });
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
      providerInstallation.dispose();
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
    const providerInstallation = installStudioCaptureProvider(async () => {
      renderCalls++;
      return {} as HTMLCanvasElement;
    });
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
      providerInstallation.dispose();
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("uses the injected provider contract and asynchronous PNG encoding", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let capturedViewport: Record<string, number> | undefined;
    let captureElementFilter: ((element: Element) => boolean) | undefined;
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
    } as unknown as Document;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    const providerInstallation = installStudioCaptureProvider(
      ({ element, viewport, shouldIgnoreElement, signal }) => {
        verifiedCalls++;
        assertEquals(element, fakeDocument.body);
        assertEquals(signal.aborted, false);
        capturedViewport = { ...viewport };
        captureElementFilter = shouldIgnoreElement;
        return Promise.resolve(canvas);
      },
    );
    const ambientImplementation = () => {
      ambientCalls++;
      return Promise.resolve(canvas);
    };
    fakeWindow.ambientStudioCapture = ambientImplementation;
    try {
      const result = await captureScreenshot();

      assertEquals(result.success, true);
      assertEquals(ambientCalls, 0);
      assertEquals(verifiedCalls, 1);
      assertEquals(fakeWindow.ambientStudioCapture, ambientImplementation);
      assertEquals(
        captureElementFilter?.({
          hasAttribute: (name: string) => name === "data-vf-studio-capture-ignore",
        } as unknown as Element),
        true,
      );
      assertEquals(
        captureElementFilter?.({ hasAttribute: () => false } as unknown as Element),
        false,
      );
      assertEquals(
        captureElementFilter?.({
          hasAttribute: () => {
            throw new Error("uninspectable");
          },
        } as unknown as Element),
        true,
      );
      assertEquals(capturedViewport?.scale, 2);
      assertEquals(capturedViewport?.width, 1_000);
      assertEquals(capturedViewport?.height, 800);
      assertEquals(capturedViewport?.x, 0);
      assertEquals(capturedViewport?.y, 25);
      assertEquals(capturedViewport?.scrollX, 0);
      assertEquals(capturedViewport?.scrollY, 25);
      assertEquals(capturedViewport?.windowWidth, 1_000);
      assertEquals(capturedViewport?.windowHeight, 800);
      assertEquals(fakeWindow.scrollY, 25);
      assertEquals(result.url, "https://preview.example/page");
      assertEquals(serializationCalls, [["image/png"]]);

      maximumScrollY = 500;
      const clamped = await captureScreenshot({ scrollTo: 900 });
      assertEquals(clamped.scrollY, 500);
      assertEquals(capturedViewport?.y, 500);
      assertEquals(capturedViewport?.scrollY, 500);

      maximumScrollY = Infinity;
      const fullPage = await captureScreenshot({ fullPage: true });
      assertEquals(fullPage.success, true);
      assertEquals(capturedViewport?.width, 1_000);
      assertEquals(capturedViewport?.height, 2_000);
      assertEquals(capturedViewport?.x, 0);
      assertEquals(capturedViewport?.y, 0);
      assertEquals(capturedViewport?.scrollX, 0);
      assertEquals(capturedViewport?.scrollY, 0);
      assertEquals(capturedViewport?.windowWidth, 1_000);
      assertEquals(capturedViewport?.windowHeight, 2_000);
      assertEquals(serializationCalls.at(-1), ["image/png"]);

      fakeWindow.ambientStudioCapture = () => {
        ambientCalls++;
        return Promise.resolve(canvas);
      };
      assertEquals((await captureScreenshot()).success, true);
      assertEquals(ambientCalls, 0);
      assertEquals(verifiedCalls, 4);
    } finally {
      providerInstallation.dispose();
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
    const captureProvider = () => Promise.resolve(canvas);
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
      ambientStudioCapture: captureProvider,
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
    const providerInstallation = installStudioCaptureProvider(captureProvider);
    try {
      const results = await captureMultipleSections(1);

      assertEquals(results[0]?.success, true);
      assertEquals(scrollCalls.at(-1), [-37, 25]);
      assertEquals([scrollX, scrollY], [-37, 25]);
    } finally {
      providerInstallation.dispose();
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("does not poison a later capture after renderer failure", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    let renderCalls = 0;
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
    const canvas = {
      width: 1_000,
      height: 800,
      toBlob(callback: BlobCallback) {
        callback(new Blob(["a".repeat(100)], { type: "image/png" }));
      },
    } as unknown as HTMLCanvasElement;

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    const providerInstallation = installStudioCaptureProvider(() => {
      renderCalls++;
      return renderCalls === 1
        ? Promise.reject(new Error("temporary renderer failure"))
        : Promise.resolve(canvas);
    });
    try {
      assertEquals((await captureScreenshot()).success, false);
      assertEquals((await captureScreenshot()).success, true);
      assertEquals(renderCalls, 2);
    } finally {
      providerInstallation.dispose();
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
    }
  });

  it("aborts and quarantines provider work that exceeds the capture deadline", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const render = Promise.withResolvers<HTMLCanvasElement>();
    let providerSignal: AbortSignal | undefined;
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
    const providerInstallation = installStudioCaptureProvider((request) => {
      providerSignal = request.signal;
      return render.promise;
    });

    try {
      assertEquals(
        await captureScreenshot(undefined, undefined, Date.now() + 20),
        { success: false, error: "Screenshot capture timed out" },
      );
      assertEquals(providerSignal?.aborted, true);
      assertEquals(await captureScreenshot(), {
        success: false,
        error: "A timed-out screenshot capture is still running",
      });

      render.resolve({} as HTMLCanvasElement);
      await render.promise;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      render.resolve({} as HTMLCanvasElement);
      await Promise.resolve();
      await Promise.resolve();
      providerInstallation.dispose();
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
    const providerInstallation = installStudioCaptureProvider(() => Promise.resolve(canvas));

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
      providerInstallation.dispose();
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
    const providerInstallation = installStudioCaptureProvider(() => Promise.resolve(canvas));

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
      providerInstallation.dispose();
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
