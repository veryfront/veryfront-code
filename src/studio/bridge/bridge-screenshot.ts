/**
 * Bridge Screenshot
 *
 * html2canvas loading, single and multi-section screenshot capture.
 */

import { logger } from "./bridge-logger.ts";
import { state } from "./bridge-state.ts";

type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;
declare const window: Window & {
  html2canvas: Html2CanvasFn & { default?: Html2CanvasFn };
  devicePixelRatio: number;
};

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

function loadHtml2Canvas(): Promise<void> {
  if (state.html2canvasLoaded) return Promise.resolve();
  if (state.html2canvasPromise) return state.html2canvasPromise;

  state.html2canvasPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.0.0/dist/html2canvas-pro.min.js";
    script.onload = () => {
      state.html2canvasLoaded = true;
      resolve();
    };
    script.onerror = (event) => {
      logger.warn(
        "Failed to load html2canvas script. This may be caused by CSP script-src restrictions.",
        { event: String(event) },
      );
      reject(new Error("Failed to load html2canvas script"));
    };
    try {
      document.head.appendChild(script);
    } catch (error) {
      logger.warn(
        "Failed to append html2canvas script element. This may be caused by CSP script-src restrictions.",
        error instanceof Error ? error : { error: String(error) },
      );
      reject(
        error instanceof Error ? error : new Error("Failed to append html2canvas script element"),
      );
    }
  });

  return state.html2canvasPromise;
}

export async function captureScreenshot(options?: {
  scrollTo?: number;
  fullPage?: boolean;
  quality?: number;
}): Promise<ScreenshotResult> {
  const { scrollTo, fullPage, quality = 0.8 } = options || {};
  const originalScrollY = window.scrollY;

  try {
    await loadHtml2Canvas();

    if (typeof scrollTo === "number") {
      window.scrollTo(0, scrollTo);
      // no cleanup needed: one-shot delay awaited inline
      await new Promise((r) => setTimeout(r, 150));
    }

    const canvasOptions: Record<string, unknown> = {
      useCORS: true,
      logging: false,
      scale: window.devicePixelRatio || 1,
    };

    if (fullPage) {
      canvasOptions.height = document.documentElement.scrollHeight;
      canvasOptions.windowHeight = document.documentElement.scrollHeight;
      canvasOptions.y = 0;
      window.scrollTo(0, 0);
      // no cleanup needed: one-shot delay awaited inline
      await new Promise((r) => setTimeout(r, 100));
    }

    const html2canvasFn = window.html2canvas.default || window.html2canvas;
    const canvas = await html2canvasFn(document.body, canvasOptions);

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      logger.error("html2canvas produced empty canvas", {
        width: canvas?.width,
        height: canvas?.height,
      });
      window.scrollTo(0, originalScrollY);
      return {
        success: false,
        error: "html2canvas produced empty canvas (0x0 dimensions)",
      };
    }

    const dataUrl = canvas.toDataURL("image/png", quality);

    if (!dataUrl || !dataUrl.startsWith("data:image/") || dataUrl.length < 100) {
      logger.error("html2canvas produced invalid data URL", {
        dataUrlPreview: dataUrl?.substring(0, 50),
      });
      window.scrollTo(0, originalScrollY);
      return {
        success: false,
        error: "html2canvas produced invalid image data",
      };
    }

    window.scrollTo(0, originalScrollY);

    return {
      success: true,
      data: dataUrl,
      width: canvas.width,
      height: canvas.height,
      scrollY: window.scrollY,
      totalHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      url: window.location.href,
    };
  } catch (error: unknown) {
    logger.error("html2canvas error", error instanceof Error ? error : { error: String(error) });
    window.scrollTo(0, originalScrollY);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function captureMultipleSections(sectionCount?: number): Promise<ScreenshotResult[]> {
  const originalScrollY = window.scrollY;
  const results: ScreenshotResult[] = [];
  const totalHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  const sections = sectionCount || Math.ceil(totalHeight / viewportHeight);

  try {
    for (let i = 0; i < sections; i++) {
      const scrollY = Math.min(i * viewportHeight, totalHeight - viewportHeight);
      const result = await captureScreenshot({ scrollTo: scrollY });
      if (result.success) {
        results.push({ ...result, section: i + 1, totalSections: sections });
      }
    }
  } finally {
    window.scrollTo(0, originalScrollY);
  }

  return results;
}
