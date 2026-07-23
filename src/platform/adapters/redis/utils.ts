export function arrayToObject(arr: string[]): Record<string, string> {
  const obj: Record<string, string> = {};

  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];

    if (!key || value === undefined) continue;

    // Defining the property avoids the legacy `__proto__` setter on Node.js
    // while preserving Redis field names exactly.
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return obj;
}
