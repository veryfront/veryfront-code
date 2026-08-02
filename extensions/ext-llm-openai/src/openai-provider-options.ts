/**
 * Merge provider-native options without invoking legacy prototype setters such
 * as `Object.prototype.__proto__`.
 */
export function defineOpenAIProviderOptions(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of Object.keys(source)) {
    Object.defineProperty(target, key, {
      value: source[key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}
