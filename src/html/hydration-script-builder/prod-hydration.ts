import type { ComponentProps } from "#veryfront/types";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { buildNonceAttribute } from "../html-escape.ts";
import {
  getUTF8ByteLength,
  MAX_HTML_HYDRATION_DATA_BYTES,
  MAX_HTML_SLUG_BYTES,
} from "../limits.ts";
import { decodePathSegmentFully, hasPathControlCharacter } from "../path-safety.ts";
import { hasUnpairedUtf16Surrogate, hasUnsafeUnicodeFormatting } from "../unicode-safety.ts";
import { createHydrationJSONSnapshotter } from "../json-snapshot.ts";

function assertSafePageSlug(slug: string): void {
  if (
    typeof slug !== "string" || slug.length === 0 || slug.length > MAX_HTML_SLUG_BYTES ||
    getUTF8ByteLength(slug) > MAX_HTML_SLUG_BYTES ||
    slug.startsWith("/") || /[\\?#<>"']/.test(slug) || hasPathControlCharacter(slug) ||
    hasUnpairedUtf16Surrogate(slug) || hasUnsafeUnicodeFormatting(slug)
  ) {
    throw new TypeError("Invalid page slug");
  }

  for (const rawSegment of slug.split("/")) {
    if (!rawSegment) throw new TypeError("Invalid page slug");
    let segment: string;
    try {
      segment = decodePathSegmentFully(rawSegment);
    } catch {
      throw new TypeError("Invalid page slug percent encoding");
    }
    if (
      segment === "." || segment === ".." || segment.includes("/") ||
      segment.includes("\\") || /[?#<>"']/.test(segment) ||
      hasPathControlCharacter(segment) || hasUnpairedUtf16Surrogate(segment) ||
      hasUnsafeUnicodeFormatting(segment)
    ) {
      throw new TypeError("Invalid page slug");
    }
  }
}

export function generateProdHydrationScript(
  slug: string,
  _params?: Record<string, string | string[]>,
  props?: ComponentProps,
  nonce?: string,
): string {
  assertSafePageSlug(slug);
  const safeProps = createHydrationJSONSnapshotter().record(
    props === undefined ? {} : props,
    "Hydration props",
  );
  const nonceAttr = buildNonceAttribute(nonce);
  const pageProps = jsonForInlineScript(safeProps);
  if (getUTF8ByteLength(pageProps) > MAX_HTML_HYDRATION_DATA_BYTES) {
    throw new TypeError("Hydration props exceed the size limit");
  }
  const pageSpecifier = jsonForInlineScript(`@/pages/${slug}`);

  return `
  <script type="module"${nonceAttr}>
    import * as React from 'react';
    import * as ReactDOM from 'react-dom/client';
    import { App } from '@/components/app';
    import { Layout } from '@/components/layout';
    import { Page } from ${pageSpecifier};

    const root = document.getElementById('root');
    if (root) {
      const tree = React.createElement(
        App,
        {},
        React.createElement(
          Layout,
          {},
          React.createElement(Page, ${pageProps})
        )
      );

      // identifierPrefix must match SSR to prevent useId() mismatch
      ReactDOM.hydrateRoot(root, tree, {
        identifierPrefix: 'vf',
        onRecoverableError: (error) => {
          const errorName = error instanceof Error ? error.name : 'UnknownError';
          console.error('[Veryfront] Hydration recovery failed (' + errorName + ')');
        },
      });
    } else {
      console.error('[Veryfront] Hydration root not found');
    }
  </script>`;
}
