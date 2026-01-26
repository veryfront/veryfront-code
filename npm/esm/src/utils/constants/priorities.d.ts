/**
 * Handler priority constants - lower numbers run first.
 * CRITICAL(0) -> VERY_HIGH(50) -> HIGH(100-300) -> MEDIUM(400-700) -> LOW(1000) -> FALLBACK(10000)
 */
export declare const PRIORITY_CRITICAL = 0;
export declare const PRIORITY_VERY_HIGH = 50;
export declare const PRIORITY_HIGH = 100;
export declare const PRIORITY_HIGH_CLIENT_LOG = 200;
export declare const PRIORITY_HIGH_DEV = 300;
export declare const PRIORITY_MEDIUM_DEV_FILES = 400;
export declare const PRIORITY_MEDIUM_STATIC = 500;
export declare const PRIORITY_MEDIUM_LIB_MODULES = 550;
export declare const PRIORITY_MEDIUM = 600;
export declare const PRIORITY_MEDIUM_API = 700;
export declare const PRIORITY_LOW = 1000;
export declare const PRIORITY_FALLBACK = 10000;
export declare const HANDLER_PRIORITIES: {
    readonly CRITICAL: 0;
    readonly VERY_HIGH: 50;
    readonly HIGH: 100;
    readonly HIGH_CLIENT_LOG: 200;
    readonly HIGH_DEV: 300;
    readonly MEDIUM_DEV_FILES: 400;
    readonly MEDIUM_STATIC: 500;
    readonly MEDIUM_LIB_MODULES: 550;
    readonly MEDIUM: 600;
    readonly MEDIUM_API: 700;
    readonly LOW: 1000;
    readonly FALLBACK: 10000;
};
//# sourceMappingURL=priorities.d.ts.map