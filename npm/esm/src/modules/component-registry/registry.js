import { serverLogger as logger } from "../../utils/index.js";
import { basename, join } from "../../platform/compat/path/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
export class ComponentRegistry {
    options;
    components = new Map();
    componentDirs;
    initializedPromise = null;
    adapter;
    initialized = false;
    constructor(options) {
        this.options = options;
        this.adapter = options.adapter;
        this.componentDirs = options.componentDirs ?? [
            "components",
            "islands",
            "src/components",
            "src/islands",
        ];
    }
    discover() {
        return withSpan("modules.componentRegistry.discover", async () => {
            this.initialized = false;
            this.initializedPromise = this._discoverInternal().then(() => {
                this.initialized = true;
            });
            await this.initializedPromise;
        }, { "registry.projectDir": this.options.projectDir });
    }
    async _discoverInternal() {
        logger.debug(`Discovering components in: ${this.componentDirs.join(", ")}`);
        for (const dir of this.componentDirs) {
            const fullPath = join(this.options.projectDir, dir);
            try {
                await this.walkDirectory(fullPath);
            }
            catch (error) {
                // Silently skip missing directories - they're optional
                const code = error?.code;
                const isNotFound = code === "ENOENT" ||
                    (error instanceof Error && error.name === "NotFound");
                if (!isNotFound) {
                    logger.warn(`Failed to discover components in ${fullPath}:`, error);
                }
            }
        }
        logger.debug(`Discovered ${this.components.size} components`);
    }
    async walkDirectory(dir) {
        const entries = this.adapter.fs.readDir(dir);
        for await (const entry of entries) {
            if (entry.name === "node_modules" ||
                entry.name.includes(".test.") ||
                entry.name.includes(".spec.")) {
                continue;
            }
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory) {
                await this.walkDirectory(fullPath);
                continue;
            }
            if (!entry.isFile || !/\.(tsx|jsx)$/.test(entry.name))
                continue;
            const ext = entry.name.substring(entry.name.lastIndexOf("."));
            const componentName = basename(entry.name, ext);
            if (componentName === "index")
                continue;
            this.components.set(componentName, {
                name: componentName,
                path: fullPath,
                isLoaded: false,
            });
            logger.debug(`Discovered component: ${componentName} at ${fullPath}`);
        }
    }
    loadComponent(name) {
        return withSpan("modules.componentRegistry.loadComponent", async () => {
            await this.initializedPromise;
            const component = this.components.get(name);
            if (!component) {
                logger.warn(`Component not found: ${name}`);
                return null;
            }
            if (component.isLoaded)
                return component;
            try {
                component.content = await this.adapter.fs.readFile(component.path);
                component.isLoaded = true;
                logger.debug(`Loaded component: ${name}`);
                return component;
            }
            catch (error) {
                logger.error(`Failed to load component ${name}:`, error);
                return null;
            }
        }, { "registry.componentName": name });
    }
    loadAll() {
        return withSpan("modules.componentRegistry.loadAll", async () => {
            await Promise.all(Array.from(this.components.keys(), (name) => this.loadComponent(name)));
        }, { "registry.componentCount": this.components.size });
    }
    get(name) {
        return this.components.get(name);
    }
    getAll() {
        return new Map(this.components);
    }
    /**
     * Loader accessor for compatibility with older tests; loader is not used in this registry.
     */
    getLoader() {
        return undefined;
    }
    /**
     * Get all components as MDXComponents record (for MDX rendering)
     */
    getAllAsComponents() {
        const components = {};
        for (const [name, info] of this.components) {
            const component = info.exports?.default;
            if (component)
                components[name] = component;
        }
        return components;
    }
    has(name) {
        return this.components.has(name);
    }
    add(name, info) {
        this.components.set(name, {
            name,
            path: info.path ?? `virtual:${name}`,
            content: info.content,
            isLoaded: true,
            exports: info.exports,
        });
    }
    remove(name) {
        this.components.delete(name);
    }
    clear() {
        this.components.clear();
        this.initialized = false;
        this.initializedPromise = null;
    }
    getComponentNames() {
        return Array.from(this.components.keys());
    }
    async listComponents() {
        const components = [];
        for (const [name, info] of this.components) {
            try {
                const stat = await this.adapter.fs.stat(info.path);
                components.push({
                    name,
                    path: info.path,
                    size: stat.size,
                    lastModified: stat.mtime?.toISOString(),
                    type: "component",
                });
            }
            catch {
                components.push({
                    name,
                    path: info.path,
                    type: "component",
                });
            }
        }
        return components;
    }
}
