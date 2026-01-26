import * as dntShim from "../../../_dnt.shims.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { isBun, isDeno, isNode } from "./runtime.js";
class NodeFileSystem {
    fs;
    os;
    path;
    initialized = false;
    async ensureInitialized() {
        if (this.initialized)
            return;
        if (!isNode && !isBun) {
            throw toError(createError({
                type: "not_supported",
                message: "Node.js fs modules not available",
                feature: "Node.js",
            }));
        }
        const [fsModule, osModule, pathModule] = await Promise.all([
            import("node:fs/promises"),
            import("node:os"),
            import("node:path"),
        ]);
        this.fs = fsModule;
        this.os = osModule;
        this.path = pathModule;
        this.initialized = true;
    }
    async readTextFile(path) {
        await this.ensureInitialized();
        return this.fs.readFile(path, { encoding: "utf8" });
    }
    async readFile(path) {
        await this.ensureInitialized();
        return this.fs.readFile(path);
    }
    async writeTextFile(path, data) {
        await this.ensureInitialized();
        await this.fs.writeFile(path, data, { encoding: "utf8" });
    }
    async writeFile(path, data) {
        await this.ensureInitialized();
        await this.fs.writeFile(path, data);
    }
    async exists(path) {
        await this.ensureInitialized();
        try {
            await this.fs.access(path);
            return true;
        }
        catch (error) {
            if (error?.code === "ENOENT")
                return false;
            throw error;
        }
    }
    async stat(path) {
        await this.ensureInitialized();
        const stat = await this.fs.stat(path);
        return {
            isFile: stat.isFile(),
            isDirectory: stat.isDirectory(),
            isSymlink: stat.isSymbolicLink(),
            size: stat.size,
            mtime: stat.mtime,
        };
    }
    async mkdir(path, options) {
        await this.ensureInitialized();
        await this.fs.mkdir(path, { recursive: options?.recursive ?? false });
    }
    async *readDir(path) {
        await this.ensureInitialized();
        const entries = await this.fs.readdir(path, { withFileTypes: true });
        for (const entry of entries) {
            yield { name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() };
        }
    }
    async remove(path, options) {
        await this.ensureInitialized();
        const recursive = options?.recursive ?? false;
        await this.fs.rm(path, { recursive, force: recursive });
    }
    async makeTempDir(options) {
        await this.ensureInitialized();
        const tempDir = this.path.join(this.os.tmpdir(), `${options?.prefix ?? "tmp-"}${Math.random().toString(36).substring(2, 8)}`);
        await this.fs.mkdir(tempDir, { recursive: true });
        return tempDir;
    }
    async chmod(path, mode) {
        await this.ensureInitialized();
        try {
            await this.fs.chmod(path, mode);
        }
        catch {
            // Ignore errors on Windows where chmod is not fully supported
        }
    }
}
class DenoFileSystem {
    readTextFile(path) {
        // @ts-ignore - Deno global
        return dntShim.Deno.readTextFile(path);
    }
    readFile(path) {
        // @ts-ignore - Deno global
        return dntShim.Deno.readFile(path);
    }
    async writeTextFile(path, data) {
        // @ts-ignore - Deno global
        await dntShim.Deno.writeTextFile(path, data);
    }
    async writeFile(path, data) {
        // @ts-ignore - Deno global
        await dntShim.Deno.writeFile(path, data);
    }
    async exists(path) {
        try {
            // @ts-ignore - Deno global
            await dntShim.Deno.stat(path);
            return true;
        }
        catch (error) {
            // @ts-ignore - Deno global
            if (error instanceof dntShim.Deno.errors.NotFound)
                return false;
            throw error;
        }
    }
    async stat(path) {
        // @ts-ignore - Deno global
        const stat = await dntShim.Deno.stat(path);
        return {
            isFile: stat.isFile,
            isDirectory: stat.isDirectory,
            isSymlink: stat.isSymlink,
            size: stat.size,
            mtime: stat.mtime,
        };
    }
    async mkdir(path, options) {
        // @ts-ignore - Deno global
        await dntShim.Deno.mkdir(path, { recursive: options?.recursive ?? false });
    }
    async *readDir(path) {
        // @ts-ignore - Deno global
        for await (const entry of dntShim.Deno.readDir(path)) {
            yield { name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory };
        }
    }
    async remove(path, options) {
        // @ts-ignore - Deno global
        await dntShim.Deno.remove(path, { recursive: options?.recursive ?? false });
    }
    makeTempDir(options) {
        // @ts-ignore - Deno global
        return dntShim.Deno.makeTempDir({ prefix: options?.prefix });
    }
    async chmod(path, mode) {
        try {
            // @ts-ignore - Deno global
            await dntShim.Deno.chmod(path, mode);
        }
        catch {
            // Ignore errors on Windows where chmod is not fully supported
        }
    }
}
export function createFileSystem() {
    return isDeno ? new DenoFileSystem() : new NodeFileSystem();
}
let _fs = null;
function getFs() {
    _fs ??= createFileSystem();
    return _fs;
}
export function readTextFile(path) {
    return getFs().readTextFile(path);
}
export function readFile(path) {
    return getFs().readFile(path);
}
export function writeTextFile(path, data) {
    return getFs().writeTextFile(path, data);
}
export function writeFile(path, data) {
    return getFs().writeFile(path, data);
}
export function exists(path) {
    return getFs().exists(path);
}
export function stat(path) {
    return getFs().stat(path);
}
export function mkdir(path, options) {
    return getFs().mkdir(path, options);
}
export function remove(path, options) {
    return getFs().remove(path, options);
}
export function readDir(path) {
    return getFs().readDir(path);
}
export function makeTempDir(options) {
    return getFs().makeTempDir(options);
}
export function chmod(path, mode) {
    return getFs().chmod(path, mode);
}
export async function symlink(target, path) {
    if (isDeno) {
        // @ts-ignore - Deno global
        await dntShim.Deno.symlink(target, path);
        return;
    }
    const fs = await import("node:fs/promises");
    await fs.symlink(target, path);
}
export function isNotFoundError(error) {
    if (isDeno && error instanceof dntShim.dntGlobalThis.Deno.errors.NotFound)
        return true;
    return error?.code === "ENOENT";
}
export function isAlreadyExistsError(error) {
    if (isDeno && error instanceof dntShim.dntGlobalThis.Deno.errors.AlreadyExists)
        return true;
    return error?.code === "EEXIST";
}
