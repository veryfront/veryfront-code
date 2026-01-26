import * as dntShim from "../../../_dnt.shims.js";
export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
class ConditionalBrowserLogger {
    prefix;
    level;
    constructor(prefix, level) {
        this.prefix = prefix;
        this.level = level;
    }
    debug(message, ...args) {
        if (this.level > LogLevel.DEBUG)
            return;
        console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
    }
    info(message, ...args) {
        if (this.level > LogLevel.INFO)
            return;
        console.log?.(`[${this.prefix}] ${message}`, ...args);
    }
    warn(message, ...args) {
        if (this.level > LogLevel.WARN)
            return;
        console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
    }
    error(message, ...args) {
        if (this.level > LogLevel.ERROR)
            return;
        console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
    }
}
function getBrowserLogLevel() {
    if (typeof dntShim.dntGlobalThis === "undefined")
        return LogLevel.WARN;
    const g = dntShim.dntGlobalThis;
    const isDevelopment = g.__VERYFRONT_DEV__ || g.__RSC_DEV__;
    if (!isDevelopment)
        return LogLevel.WARN;
    const isDebugEnabled = g.__VERYFRONT_DEBUG__ || g.__RSC_DEBUG__;
    return isDebugEnabled ? LogLevel.DEBUG : LogLevel.INFO;
}
const defaultLevel = getBrowserLogLevel();
export const rscLogger = new ConditionalBrowserLogger("RSC", defaultLevel);
export const prefetchLogger = new ConditionalBrowserLogger("PREFETCH", defaultLevel);
export const hydrateLogger = new ConditionalBrowserLogger("HYDRATE", defaultLevel);
export const browserLogger = new ConditionalBrowserLogger("VERYFRONT", defaultLevel);
