/**************************
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 **************************/
export class ErrorCollector {
    errors = new Map();
    subscribers = new Set();
    idCounter = 0;
    maxErrors;
    constructor(options = {}) {
        this.maxErrors = options.maxErrors ?? 100;
    }
    generateId() {
        return `err_${Date.now()}_${++this.idCounter}`;
    }
    add(error) {
        const fullError = {
            ...error,
            id: this.generateId(),
            timestamp: Date.now(),
        };
        if (this.errors.size >= this.maxErrors) {
            const oldestId = this.errors.keys().next().value;
            if (oldestId)
                this.errors.delete(oldestId);
        }
        this.errors.set(fullError.id, fullError);
        for (const subscriber of this.subscribers) {
            try {
                subscriber(fullError);
            }
            catch {
                // Ignore subscriber errors
            }
        }
        return fullError;
    }
    addCompileError(message, file, line, column) {
        return this.add({ type: "compile", message, file, line, column });
    }
    addRuntimeError(message, stack, context) {
        return this.add({ type: "runtime", message, stack, context });
    }
    addBundleError(message, file, context) {
        return this.add({ type: "bundle", message, file, context });
    }
    addHMRError(message, file, context) {
        return this.add({ type: "hmr", message, file, context });
    }
    addModuleError(message, file, context) {
        return this.add({ type: "module", message, file, context });
    }
    getAll(filter) {
        let errors = Array.from(this.errors.values());
        if (!filter)
            return errors;
        const { type, file, since } = filter;
        if (type) {
            const types = Array.isArray(type) ? type : [type];
            errors = errors.filter((e) => types.includes(e.type));
        }
        if (file) {
            if (typeof file === "string") {
                errors = errors.filter((e) => e.file === file);
            }
            else {
                errors = errors.filter((e) => (e.file ? file.test(e.file) : false));
            }
        }
        if (since) {
            errors = errors.filter((e) => e.timestamp >= since);
        }
        return errors;
    }
    get(id) {
        return this.errors.get(id);
    }
    clearFile(file) {
        return this.clearWhere((error) => error.file === file);
    }
    clearType(type) {
        return this.clearWhere((error) => error.type === type);
    }
    clear() {
        this.errors.clear();
    }
    get count() {
        return this.errors.size;
    }
    countByType() {
        const counts = {
            compile: 0,
            runtime: 0,
            bundle: 0,
            hmr: 0,
            module: 0,
        };
        for (const { type } of this.errors.values()) {
            counts[type]++;
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
    clearWhere(predicate) {
        let cleared = 0;
        for (const [id, error] of this.errors) {
            if (!predicate(error))
                continue;
            this.errors.delete(id);
            cleared++;
        }
        return cleared;
    }
}
let globalCollector = null;
export function getErrorCollector() {
    globalCollector ??= new ErrorCollector();
    return globalCollector;
}
export function resetErrorCollector() {
    globalCollector?.clear();
    globalCollector = null;
}
export function parseCompileError(output) {
    const tsMatch = output.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/m);
    if (tsMatch) {
        const [, file, line = "0", column = "0", message] = tsMatch;
        return {
            type: "compile",
            file,
            line: parseInt(line, 10),
            column: parseInt(column, 10),
            message,
        };
    }
    const esbuildMatch = output.match(/^ERROR:\s*\[([^\]]+):(\d+):(\d+)\]\s*(.+)$/m);
    if (esbuildMatch) {
        const [, file, line = "0", column = "0", message] = esbuildMatch;
        return {
            type: "bundle",
            file,
            line: parseInt(line, 10),
            column: parseInt(column, 10),
            message,
        };
    }
    if (output.includes("error") || output.includes("Error")) {
        return { type: "compile", message: output.trim() };
    }
    return null;
}
