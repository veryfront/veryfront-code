import { getReactVersionInfo } from "../version-detector/index.js";
import { Singleflight } from "../../../utils/singleflight.js";

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;
  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;
  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

let projectReactCache: typeof import("react") | null = null;
let reactDOMServerCache: ReactDOMServer | null = null;

const reactLoadFlight = new Singleflight<typeof import("react")>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();

export function resetReactCache(): void {
  projectReactCache = null;
  reactDOMServerCache = null;
}

export function getProjectReact(): Promise<typeof import("react")> {
  if (projectReactCache) return Promise.resolve(projectReactCache);

  return reactLoadFlight.do("react", async () => {
    if (projectReactCache) return projectReactCache;

    const reactModule = await import("react");
    projectReactCache = (reactModule.default ?? reactModule) as typeof import("react");
    return projectReactCache;
  });
}

export function getReactDOMServer(): Promise<ReactDOMServer> {
  if (reactDOMServerCache) return Promise.resolve(reactDOMServerCache);

  return reactDOMServerLoadFlight.do("react-dom-server", async () => {
    if (reactDOMServerCache) return reactDOMServerCache;

    const versionInfo = getReactVersionInfo();
    const serverModule = await import("react-dom/server");

    const react18Plus = versionInfo.isReact18 || versionInfo.isReact19;

    reactDOMServerCache = {
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    return reactDOMServerCache;
  });
}
