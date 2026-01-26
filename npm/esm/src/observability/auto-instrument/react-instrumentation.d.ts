import * as dntShim from "../../../_dnt.shims.js";
export declare function instrumentReactRender<T>(renderFn: () => Promise<T> | T, componentName: string): Promise<T>;
export declare function instrumentErrorHandler(handler: (error: Error, request?: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response, captureToSpan?: boolean): (error: Error, request?: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response;
//# sourceMappingURL=react-instrumentation.d.ts.map