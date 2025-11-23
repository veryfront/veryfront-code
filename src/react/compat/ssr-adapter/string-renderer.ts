import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getReactDOMServer } from "./server-loader.ts";
import type { SSROptions } from "./types.ts";

export async function renderToStringAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const { renderToString } = await getReactDOMServer();

  try {
    return renderToString(element as Parameters<typeof renderToString>[0]);
  } catch (error) {
    logger.error("SSR renderToString failed", error);
    options.onError?.(error as Error);
    throw error;
  }
}

export async function renderToStaticMarkupAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const { renderToStaticMarkup } = await getReactDOMServer();

  try {
    return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
  } catch (error) {
    logger.error("SSR renderToStaticMarkup failed", error);
    options.onError?.(error as Error);
    throw error;
  }
}
