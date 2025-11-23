import { rendererLogger as logger } from "@veryfront/utils";
import { getReactVersionInfo } from "../version-detector/index.ts";

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;

  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;

  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;

  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

export async function getReactDOMServer(): Promise<ReactDOMServer> {
  const versionInfo = getReactVersionInfo();

  const { renderToString, renderToStaticMarkup } = await import("react-dom/server");

  let renderToPipeableStream: typeof import("react-dom/server").renderToPipeableStream | undefined;
  let renderToReadableStream: typeof import("react-dom/server").renderToReadableStream | undefined;

  if (versionInfo.isReact18 || versionInfo.isReact19) {
    try {
      const serverModule = await import("react-dom/server");
      renderToPipeableStream = serverModule
        .renderToPipeableStream as typeof import("react-dom/server").renderToPipeableStream;
      renderToReadableStream = serverModule
        .renderToReadableStream as typeof import("react-dom/server").renderToReadableStream;
    } catch (error) {
      logger.warn("Failed to import React 18+ streaming methods", error);
    }
  }

  return {
    renderToString,
    renderToStaticMarkup,
    renderToPipeableStream,
    renderToReadableStream,
  };
}
