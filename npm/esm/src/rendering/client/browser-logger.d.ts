export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export interface BrowserLogger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
declare class ConditionalBrowserLogger implements BrowserLogger {
    private prefix;
    private level;
    constructor(prefix: string, level: LogLevel);
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
export declare const rscLogger: ConditionalBrowserLogger;
export declare const prefetchLogger: ConditionalBrowserLogger;
export declare const hydrateLogger: ConditionalBrowserLogger;
export declare const browserLogger: ConditionalBrowserLogger;
export {};
//# sourceMappingURL=browser-logger.d.ts.map