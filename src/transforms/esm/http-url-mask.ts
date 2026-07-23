// Mask complete HTTP URL string literals before parsing so URL syntax cannot be
// mistaken for JavaScript comments by lightweight lexer implementations.
const HTTP_URL_PATTERN = /(?<!\\)(['"`])(https?:\/\/[^'"`\n\\]+)\1/g;

export interface HttpUrlMaskResult {
  masked: string;
  urlMap: Map<string, string>;
}

/** Mask HTTP URL literals with tokens whose prefix is absent from the source. */
export function maskHttpUrls(code: string): HttpUrlMaskResult {
  const urlMap = new Map<string, string>();
  let placeholderPrefix = "__VF_HTTP_MASK_";
  while (code.includes(placeholderPrefix)) placeholderPrefix += "_";

  let counter = 0;
  const masked = code.replace(HTTP_URL_PATTERN, (_match, quote: string, url: string) => {
    const placeholder = `${placeholderPrefix}${counter++}__`;
    urlMap.set(placeholder, url);
    return `${quote}${placeholder}${quote}`;
  });

  return { masked, urlMap };
}

/** Restore URL tokens produced by {@link maskHttpUrls}. */
export function unmaskHttpUrls(code: string, urlMap: Map<string, string>): string {
  let result = code;
  for (const [placeholder, url] of urlMap) result = result.replaceAll(placeholder, url);
  return result;
}
