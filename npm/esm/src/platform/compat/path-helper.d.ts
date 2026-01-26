import * as stdPath from "./shims/std-path.js";
export declare const basename: (path: string, suffix?: string) => string;
export declare const dirname: (path: string) => string;
export declare const extname: (path: string) => string;
export declare const fromFileUrl: typeof stdPath.fromFileUrl;
export declare const isAbsolute: (path: string) => boolean;
export declare const join: (...paths: string[]) => string;
export declare const relative: (from: string, to: string) => string;
export declare const resolve: (...paths: string[]) => string;
export declare const sep: "/" | "\\";
//# sourceMappingURL=path-helper.d.ts.map