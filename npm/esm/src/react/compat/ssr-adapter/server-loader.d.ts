export interface ReactDOMServer {
    renderToString: typeof import("react-dom/server").renderToString;
    renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
    renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;
    renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}
export declare function resetReactCache(): void;
export declare function getProjectReact(): Promise<typeof import("react")>;
export declare function getReactDOMServer(): Promise<ReactDOMServer>;
//# sourceMappingURL=server-loader.d.ts.map