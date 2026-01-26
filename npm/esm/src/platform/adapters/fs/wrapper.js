export function isExtendedFSAdapter(fs) {
    return "isVeryfrontAdapter" in fs && "getUnderlyingAdapter" in fs && "isMultiProjectMode" in fs;
}
export class NotSupportedError extends Error {
    constructor(operation, adapterType) {
        super(adapterType
            ? `Operation '${operation}' is not supported by ${adapterType}`
            : `Operation '${operation}' is not supported by this FSAdapter`);
        this.name = "NotSupportedError";
    }
}
function isContextualAdapter(adapter) {
    return "setRequestToken" in adapter || "runWithContext" in adapter;
}
export class FSAdapterWrapper {
    _fsAdapter;
    constructor(fsAdapter) {
        this._fsAdapter = fsAdapter;
    }
    getUnderlyingAdapter() {
        return this._fsAdapter;
    }
    getAdapterType() {
        return this._fsAdapter.constructor.name;
    }
    isVeryfrontAdapter() {
        const name = this._fsAdapter.constructor.name;
        return name === "VeryfrontFSAdapter" || name === "MultiProjectFSAdapter";
    }
    get contextual() {
        if (!isContextualAdapter(this._fsAdapter)) {
            throw new NotSupportedError("contextual operations", this._fsAdapter.constructor.name);
        }
        return this._fsAdapter;
    }
    setRequestToken(token) {
        const adapter = this.contextual;
        if (!adapter.setRequestToken) {
            throw new NotSupportedError("setRequestToken", this._fsAdapter.constructor.name);
        }
        adapter.setRequestToken(token);
    }
    clearRequestToken() {
        const adapter = this.contextual;
        if (!adapter.clearRequestToken) {
            throw new NotSupportedError("clearRequestToken", this._fsAdapter.constructor.name);
        }
        adapter.clearRequestToken();
    }
    setRequestBranch(branch) {
        const adapter = this.contextual;
        if (!adapter.setRequestBranch) {
            throw new NotSupportedError("setRequestBranch", this._fsAdapter.constructor.name);
        }
        adapter.setRequestBranch(branch);
    }
    getRequestBranch() {
        const adapter = this.contextual;
        if (!adapter.getRequestBranch) {
            throw new NotSupportedError("getRequestBranch", this._fsAdapter.constructor.name);
        }
        return adapter.getRequestBranch();
    }
    clearRequestBranch() {
        const adapter = this.contextual;
        if (!adapter.clearRequestBranch) {
            throw new NotSupportedError("clearRequestBranch", this._fsAdapter.constructor.name);
        }
        adapter.clearRequestBranch();
    }
    setProductionMode(enabled, releaseId) {
        const adapter = this.contextual;
        if (!adapter.setProductionMode) {
            throw new NotSupportedError("setProductionMode", this._fsAdapter.constructor.name);
        }
        adapter.setProductionMode(enabled, releaseId);
    }
    runWithContext(projectSlug, token, fn, projectId, options) {
        const adapter = this.contextual;
        if (!adapter.runWithContext) {
            throw new NotSupportedError("runWithContext", this._fsAdapter.constructor.name);
        }
        return adapter.runWithContext(projectSlug, token, fn, projectId, options);
    }
    isMultiProjectMode() {
        return isContextualAdapter(this._fsAdapter) &&
            typeof this._fsAdapter.runWithContext === "function";
    }
    isContextualMode() {
        return isContextualAdapter(this._fsAdapter);
    }
    async readFile(path) {
        if (this._fsAdapter.readTextFile) {
            return this._fsAdapter.readTextFile(path);
        }
        const result = await this._fsAdapter.readFile(path);
        return typeof result === "string" ? result : new TextDecoder().decode(result);
    }
    async readFileBytes(path) {
        const result = await this._fsAdapter.readFile(path);
        return typeof result === "string" ? new TextEncoder().encode(result) : result;
    }
    async writeFile(path, content) {
        if (!this._fsAdapter.writeFile) {
            throw new NotSupportedError("writeFile", this._fsAdapter.constructor.name);
        }
        await this._fsAdapter.writeFile(path, content);
    }
    exists(path) {
        return this._fsAdapter.exists(path);
    }
    async getDirEntries(path) {
        if (this._fsAdapter.readdir) {
            const result = this._fsAdapter.readdir(path);
            if (result instanceof Promise) {
                return await result;
            }
            return await Array.fromAsync(result);
        }
        if (this._fsAdapter.readDir) {
            return await Array.fromAsync(this._fsAdapter.readDir(path));
        }
        throw new NotSupportedError("readdir", this._fsAdapter.constructor.name);
    }
    async *readDir(path) {
        const entries = await this.getDirEntries(path);
        for (const entry of entries) {
            yield {
                name: entry.name,
                isFile: entry.isFile,
                isDirectory: entry.isDirectory,
                isSymlink: entry.isSymlink,
            };
        }
    }
    readdir(path) {
        return this.getDirEntries(path);
    }
    async stat(path) {
        const info = await this._fsAdapter.stat(path);
        return {
            size: info.size,
            isFile: info.isFile,
            isDirectory: info.isDirectory,
            isSymlink: info.isSymlink,
            mtime: info.mtime,
        };
    }
    resolveFile(basePath) {
        if (!this._fsAdapter.resolveFile) {
            throw new NotSupportedError("resolveFile", this._fsAdapter.constructor.name);
        }
        return this._fsAdapter.resolveFile(basePath);
    }
    async mkdir(path, options) {
        if (!this._fsAdapter.mkdir) {
            throw new NotSupportedError("mkdir", this._fsAdapter.constructor.name);
        }
        await this._fsAdapter.mkdir(path, options);
    }
    async remove(path, options) {
        if (!this._fsAdapter.remove) {
            throw new NotSupportedError("remove", this._fsAdapter.constructor.name);
        }
        await this._fsAdapter.remove(path, options);
    }
    makeTempDir(_prefix) {
        throw new NotSupportedError("makeTempDir", this._fsAdapter.constructor.name);
    }
    watch(_paths, _options) {
        throw new NotSupportedError("watch", this._fsAdapter.constructor.name);
    }
    async shutdown() {
        await this._fsAdapter.shutdown?.();
    }
}
export function wrapFSAdapter(fsAdapter) {
    return new FSAdapterWrapper(fsAdapter);
}
