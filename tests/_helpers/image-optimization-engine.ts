import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type ImageOptimizationEngine,
  ImageOptimizationEngineName,
} from "#veryfront/extensions/image/index.ts";

export function createTestImageOptimizationEngine(): ImageOptimizationEngine {
  return {
    cacheIdentity: "test-image-optimization-engine@1",
    optimize: (request) =>
      Promise.resolve({
        sourceWidth: 1,
        sourceHeight: 1,
        variants: request.variants.map((variant) => ({
          format: variant.format,
          width: variant.width,
          height: variant.width,
          data: new Uint8Array([variant.quality]),
        })),
      }),
  };
}

export async function withTestImageOptimizationEngine<T>(
  callback: () => Promise<T> | T,
): Promise<T> {
  const previous = tryResolve<unknown>(ImageOptimizationEngineName);
  unregister(ImageOptimizationEngineName);
  register(ImageOptimizationEngineName, createTestImageOptimizationEngine());
  try {
    return await callback();
  } finally {
    unregister(ImageOptimizationEngineName);
    if (previous !== undefined) {
      register(ImageOptimizationEngineName, previous);
    }
  }
}
