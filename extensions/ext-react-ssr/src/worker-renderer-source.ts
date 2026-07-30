/** Build-time React renderer entrypoint for the extension-owned offline bundle. */

import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { IsolatedSsrRenderer, IsolatedSsrRendererModule } from "veryfront/extensions";

/** Construct a worker-realm renderer with no host-global registration. */
export const createIsolatedSsrRenderer: IsolatedSsrRendererModule["createIsolatedSsrRenderer"] =
  (): IsolatedSsrRenderer =>
    Object.freeze({
      createElement: createElement as IsolatedSsrRenderer["createElement"],
      renderToReadableStream:
        renderToReadableStream as IsolatedSsrRenderer["renderToReadableStream"],
    });
