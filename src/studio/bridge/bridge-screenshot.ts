/**
 * Bridge Screenshot
 *
 * html2canvas loading, single and multi-section screenshot capture.
 */

import { state } from "./bridge-state.ts";

declare const window: Window & {
  html2canvas: any;
  devicePixelRatio: number;
};

function loadHtml2Canvas(): Promise<void> {
  if (state.html2canvasLoaded) return Promise.resolve();
  if (state.html2canvasPromise) return state.html2canvasPromise;

  state.html2canvasPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.0.0/dist/html2canvas-pro.min.js";
    script.onload = () => {
      state.html2canvasLoaded = true;
      resolve();
    };
    script.onerror = (event) => {
      console.warn(
        "[StudioBridge] Failed to load html2canvas script. This may be caused by CSP script-src restrictions.",
        event,
      );
      reject(new Error("Failed to load html2canvas script"));
    };
    try {
      document.head.appendChild(script);
    } catch (error) {
      console.warn(
        "[StudioBridge] Failed to append html2canvas script element. This may be caused by CSP script-src restrictions.",
        error,
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
}): Promise<any> {
  const { scrollTo, fullPage, quality = 0.8 } = options || {};
  const originalScrollY = window.scrollY;

  try {
    await loadHtml2Canvas();

    if (typeof scrollTo === "number") {
      window.scrollTo(0, scrollTo);
      await new Promise((r) => setTimeout(r, 150));
    }

    const canvasOptions: any = {
      useCORS: true,
      logging: false,
      scale: window.devicePixelRatio || 1,
    };

    if (fullPage) {
      canvasOptions.height = document.documentElement.scrollHeight;
      canvasOptions.windowHeight = document.documentElement.scrollHeight;
      canvasOptions.y = 0;
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 100));
    }

    const html2canvasFn = window.html2canvas.default || window.html2canvas;
    const canvas = await html2canvasFn(document.body, canvasOptions);

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      console.error(
        "[bridge] html2canvas produced empty canvas:",
        canvas?.width,
        "x",
        canvas?.height,
      );
      window.scrollTo(0, originalScrollY);
      return {
        success: false,
        error: "html2canvas produced empty canvas (0x0 dimensions)",
      };
    }

    const dataUrl = canvas.toDataURL("image/png", quality);

    if (!dataUrl || !dataUrl.startsWith("data:image/") || dataUrl.length < 100) {
      console.error(
        "[bridge] html2canvas produced invalid data URL:",
        dataUrl?.substring(0, 50),
      );
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
  } catch (error: any) {
    console.error("[bridge] html2canvas error:", error);
    window.scrollTo(0, originalScrollY);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

export async function captureMultipleSections(sectionCount?: number): Promise<any[]> {
  const originalScrollY = window.scrollY;
  const results: any[] = [];
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
