/**
 * Invoke consumer code without allowing it to interrupt transport cleanup.
 */
export function invokeLifecycleCallback<TArgs extends unknown[]>(
  label: string,
  callback: ((...args: TArgs) => unknown) | undefined,
  ...args: TArgs
): void {
  if (!callback) return;

  try {
    void Promise.resolve(callback(...args)).catch((error) => {
      console.error(`[${label}] Callback failed:`, error);
    });
  } catch (error) {
    console.error(`[${label}] Callback failed:`, error);
  }
}

export interface GenerationTimeout {
  generation: number;
  handle: ReturnType<typeof globalThis.setTimeout>;
}

export interface GenerationInterval {
  generation: number;
  handle: ReturnType<typeof globalThis.setInterval>;
}
