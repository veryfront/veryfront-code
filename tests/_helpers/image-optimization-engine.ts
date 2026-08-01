/** Test-only explicit composition helpers for ImageOptimizationEngine. */

import { register, tryResolve, unregister } from "../../src/extensions/contracts.ts";
import type {
  ImageOptimizationEngine,
  ImageOptimizationRequest,
  ImageOptimizationResult,
} from "../../src/extensions/image/index.ts";
import { ImageOptimizationEngineName } from "../../src/extensions/image/index.ts";

function defaultTestImageOptimize(
  request: ImageOptimizationRequest,
): Promise<ImageOptimizationResult> {
  const sourceWidth = 1;
  const widths = [
    ...new Set([
      ...request.targetWidths.filter((width) => width <= sourceWidth),
      sourceWidth,
    ]),
  ];
  return Promise.resolve({
    sourceWidth,
    sourceHeight: 1,
    variants: widths.flatMap((width) =>
      request.formats.map((format) => ({
        format,
        width,
        height: width,
        data: new Uint8Array([request.quality]),
      }))
    ),
  });
}

export function createTestImageOptimizationEngine(
  optimize: (
    request: ImageOptimizationRequest,
  ) => Promise<ImageOptimizationResult> = defaultTestImageOptimize,
  cacheIdentity = "test-image-optimization-engine@1",
): ImageOptimizationEngine {
  return { cacheIdentity, optimize };
}

/** Explicitly compose a test engine and return an idempotent restoration callback. */
export function installTestImageOptimizationEngine(
  engine: ImageOptimizationEngine = createTestImageOptimizationEngine(),
): () => void {
  const previous = tryResolve<ImageOptimizationEngine>(ImageOptimizationEngineName);
  unregister(ImageOptimizationEngineName);
  register(ImageOptimizationEngineName, engine);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    unregister(ImageOptimizationEngineName);
    if (previous !== undefined) register(ImageOptimizationEngineName, previous);
  };
}

export async function withTestImageOptimizationEngine<T>(
  engine: ImageOptimizationEngine,
  run: () => Promise<T> | T,
): Promise<T> {
  const restore = installTestImageOptimizationEngine(engine);
  try {
    return await run();
  } finally {
    restore();
  }
}
