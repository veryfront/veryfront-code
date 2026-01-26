import { dirname, join } from "../../../platform/compat/path-helper.js";
import { getLocalAdapter } from "../../../platform/adapters/registry.js";
import { getErrorMessage } from "../../../errors/veryfront-error.js";
export class FilesystemCacheStore {
    baseDir;
    localAdapterPromise;
    constructor(options) {
        this.baseDir = options.baseDir;
        this.localAdapterPromise = getLocalAdapter();
    }
    async getLocalFS() {
        const adapter = await this.localAdapterPromise;
        return adapter.fs;
    }
    async get(key) {
        try {
            const file = await this.readFileForKey(key);
            if (!file)
                return undefined;
            return JSON.parse(file);
        }
        catch {
            return undefined;
        }
    }
    async set(key, value) {
        const filePath = this.filePathForKey(key);
        await this.ensureDir(dirname(filePath));
        const fs = await this.getLocalFS();
        await fs.writeFile(filePath, JSON.stringify(value));
    }
    async delete(key) {
        const filePath = this.filePathForKey(key);
        try {
            const fs = await this.getLocalFS();
            await fs.remove(filePath);
        }
        catch {
            // ignore missing files
        }
    }
    async deleteByPrefix(prefix) {
        const fs = await this.getLocalFS();
        const encodedPrefix = encodeURIComponent(prefix);
        let deleted = 0;
        try {
            for await (const entry of fs.readDir(this.baseDir)) {
                if (!entry.isFile || !entry.name.endsWith(".json"))
                    continue;
                if (!entry.name.startsWith(encodedPrefix))
                    continue;
                await fs.remove(join(this.baseDir, entry.name));
                deleted++;
            }
        }
        catch {
            // ignore missing dir or read errors
        }
        return deleted;
    }
    async clear() {
        try {
            const fs = await this.getLocalFS();
            await fs.remove(this.baseDir, { recursive: true });
        }
        catch {
            // ignore
        }
    }
    async destroy() {
        await this.clear();
    }
    filePathForKey(key) {
        return join(this.baseDir, `${encodeURIComponent(key)}.json`);
    }
    async ensureDir(path) {
        try {
            const fs = await this.getLocalFS();
            await fs.mkdir(path, { recursive: true });
        }
        catch (error) {
            if (getErrorMessage(error).includes("exists"))
                return;
            throw error;
        }
    }
    async readFileForKey(key) {
        const filePath = this.filePathForKey(key);
        try {
            const fs = await this.getLocalFS();
            return await fs.readFile(filePath);
        }
        catch {
            return null;
        }
    }
}
