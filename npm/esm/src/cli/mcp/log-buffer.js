export class LogBuffer {
    entries = [];
    subscribers = new Set();
    idCounter = 0;
    maxSize;
    constructor(options = {}) {
        this.maxSize = options.maxSize ?? 1000;
    }
    generateId() {
        return `log_${Date.now()}_${++this.idCounter}`;
    }
    append(entry) {
        const fullEntry = {
            ...entry,
            id: this.generateId(),
            timestamp: Date.now(),
        };
        this.entries.push(fullEntry);
        while (this.entries.length > this.maxSize) {
            this.entries.shift();
        }
        for (const subscriber of this.subscribers) {
            try {
                subscriber(fullEntry);
            }
            catch {
                // Ignore subscriber errors
            }
        }
        return fullEntry;
    }
    debug(message, source = "server", data) {
        return this.append({ level: "debug", message, source, data });
    }
    info(message, source = "server", data) {
        return this.append({ level: "info", message, source, data });
    }
    warn(message, source = "server", data) {
        return this.append({ level: "warn", message, source, data });
    }
    error(message, source = "server", data) {
        return this.append({ level: "error", message, source, data });
    }
    query(filter) {
        if (!filter)
            return [...this.entries];
        let results = [...this.entries];
        if (filter.level) {
            const levels = Array.isArray(filter.level) ? filter.level : [filter.level];
            results = results.filter((e) => levels.includes(e.level));
        }
        if (filter.source) {
            const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
            results = results.filter((e) => sources.includes(e.source));
        }
        if (filter.pattern) {
            const pattern = filter.pattern;
            if (typeof pattern === "string") {
                const lower = pattern.toLowerCase();
                results = results.filter((e) => e.message.toLowerCase().includes(lower));
            }
            else {
                results = results.filter((e) => pattern.test(e.message));
            }
        }
        if (filter.since != null) {
            const since = filter.since;
            results = results.filter((e) => e.timestamp >= since);
        }
        if (filter.limit != null && results.length > filter.limit) {
            results = results.slice(-filter.limit);
        }
        return results;
    }
    tail(count = 50) {
        return this.entries.slice(-count);
    }
    getAll() {
        return [...this.entries];
    }
    clear() {
        this.entries = [];
    }
    get count() {
        return this.entries.length;
    }
    countByLevel() {
        const counts = { debug: 0, info: 0, warn: 0, error: 0 };
        for (const entry of this.entries) {
            counts[entry.level]++;
        }
        return counts;
    }
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }
    toJSON() {
        return this.getAll();
    }
    format(entries) {
        const logs = entries ?? this.entries;
        return logs
            .map((e) => {
            const time = new Date(e.timestamp).toISOString().slice(11, 23);
            const level = e.level.toUpperCase().padEnd(5);
            const source = e.source.padEnd(10);
            return `${time} ${level} [${source}] ${e.message}`;
        })
            .join("\n");
    }
}
let globalBuffer = null;
export function getLogBuffer() {
    globalBuffer ??= new LogBuffer();
    return globalBuffer;
}
export function resetLogBuffer() {
    globalBuffer?.clear();
    globalBuffer = null;
}
export function interceptConsole(buffer, source = "console") {
    const original = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        debug: console.debug,
    };
    function formatArgs(...args) {
        return args
            .map((a) => {
            if (typeof a === "string")
                return a;
            try {
                return JSON.stringify(a);
            }
            catch {
                return String(a);
            }
        })
            .join(" ");
    }
    function wrap(method, log) {
        return (...args) => {
            log(formatArgs(...args), source);
            original[method].apply(console, args);
        };
    }
    console.log = wrap("log", buffer.info.bind(buffer));
    console.info = wrap("info", buffer.info.bind(buffer));
    console.warn = wrap("warn", buffer.warn.bind(buffer));
    console.error = wrap("error", buffer.error.bind(buffer));
    console.debug = wrap("debug", buffer.debug.bind(buffer));
    return () => {
        Object.assign(console, original);
    };
}
