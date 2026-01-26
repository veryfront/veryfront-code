import { getReactVersionInfo } from "../version-detector/index.js";
import { Singleflight } from "../../../utils/singleflight.js";
let projectReactCache = null;
let reactDOMServerCache = null;
const reactLoadFlight = new Singleflight();
const reactDOMServerLoadFlight = new Singleflight();
export function resetReactCache() {
    projectReactCache = null;
    reactDOMServerCache = null;
}
export function getProjectReact() {
    if (projectReactCache)
        return Promise.resolve(projectReactCache);
    return reactLoadFlight.do("react", async () => {
        if (projectReactCache)
            return projectReactCache;
        const reactModule = await import("react");
        projectReactCache = (reactModule.default ?? reactModule);
        return projectReactCache;
    });
}
export function getReactDOMServer() {
    if (reactDOMServerCache)
        return Promise.resolve(reactDOMServerCache);
    return reactDOMServerLoadFlight.do("react-dom-server", async () => {
        if (reactDOMServerCache)
            return reactDOMServerCache;
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
