/**
 * SSR Module Loader Class
 *
 * Loads and transforms React components for server-side rendering.
 *
 * @module module-system/react-loader/ssr-module-loader/loader
 */
import * as dntShim from "../../../../_dnt.shims.js";
import { isAbsolute, join } from "../../../platform/compat/path/index.js";
import { cwd } from "../../../platform/compat/process.js";
import { transformToESM } from "../../../transforms/esm/index.js";
import { TRANSFORM_CACHE_VERSION } from "../../../transforms/esm/package-registry.js";
import { buildSSRModuleCacheKey, buildSSRModuleProjectKey } from "../../../cache/keys.js";
import { parseLocalImports, } from "../../../transforms/esm/import-parser.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { rendererLogger as logger } from "../../../utils/index.js";
import { getApiBaseUrlEnv } from "../../../config/env.js";
import { injectContext, withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../observability/tracing/span-names.js";
import { extractComponent } from "../extract-component.js";
import { CIRCUIT_BREAKER_RESET_MS, CIRCUIT_BREAKER_THRESHOLD, IN_PROGRESS_WAIT_TIMEOUT_MS, MAX_CONCURRENT_TRANSFORMS, MAX_TRANSFORM_DEPTH, TRANSFORM_ACQUIRE_TIMEOUT_MS, TRANSFORM_BATCH_SIZE, } from "./constants.js";
import { withTimeoutThrow } from "../../../rendering/utils/stream-utils.js";
import { failedComponents, getFromRedis, getRedisClientInstance, getRedisEnabled, globalCrossProjectCache, globalInProgress, globalModuleCache, globalTmpDirs, setInRedis, transformSemaphore, } from "./cache/index.js";
import { getCacheBaseDir } from "../../../utils/cache-dir.js";
/**
 * SSR Module Loader with Redis Support.
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 */
export class SSRModuleLoader {
    options;
    fs = createFileSystem();
    missingDependencies = [];
    constructor(options) {
        this.options = options;
    }
    /**
     * Load and transform a module for SSR.
     */
    loadModule(filePath, source) {
        const fileName = filePath.split("/").pop() || filePath;
        return withSpan(SpanNames.SSR_LOAD_MODULE, async () => {
            const circuitKey = this.getCacheKey(filePath);
            this.checkCircuitBreaker(circuitKey, filePath);
            this.missingDependencies = [];
            try {
                await this.transformWithDependencies(filePath, source);
                if (this.missingDependencies.length > 0) {
                    this.throwMissingDependencies(filePath);
                }
                const cacheKey = this.getCacheKey(filePath);
                const cacheEntry = globalModuleCache.get(cacheKey);
                if (!cacheEntry) {
                    throw toError(createError({
                        type: "build",
                        message: `Failed to transform module: ${filePath}`,
                        context: { file: filePath, phase: "transform" },
                    }));
                }
                const mod = await withSpan(SpanNames.SSR_DYNAMIC_IMPORT, () => import(`file://${cacheEntry.tempPath}?v=${cacheEntry.contentHash}`), { "ssr.file": fileName });
                failedComponents.delete(circuitKey);
                return extractComponent(mod, filePath);
            }
            catch (error) {
                const existing = failedComponents.get(circuitKey);
                failedComponents.set(circuitKey, {
                    count: (existing?.count ?? 0) + 1,
                    lastFailure: Date.now(),
                });
                throw error;
            }
        }, {
            "ssr.file": fileName,
            "ssr.project_id": this.options.projectId,
            "ssr.source_length": source.length,
        });
    }
    checkCircuitBreaker(circuitKey, filePath) {
        const failureRecord = failedComponents.get(circuitKey);
        if (!failureRecord)
            return;
        const timeSinceFailure = Date.now() - failureRecord.lastFailure;
        if (failureRecord.count >= CIRCUIT_BREAKER_THRESHOLD &&
            timeSinceFailure < CIRCUIT_BREAKER_RESET_MS) {
            throw toError(createError({
                type: "build",
                message: `Component ${filePath} is temporarily blocked due to repeated failures. Will retry in ${Math.ceil((CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000)}s.`,
                context: {
                    file: filePath,
                    phase: "circuit-breaker",
                    failures: failureRecord.count,
                },
            }));
        }
        if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
            failedComponents.delete(circuitKey);
        }
    }
    throwMissingDependencies(filePath) {
        const missingList = this.missingDependencies
            .map((m) => `  - ${m.specifier} (from ${m.fromFile.slice(-40)}): ${m.reason}`)
            .join("\n");
        logger.error("[SSR-MODULE-LOADER] Missing dependencies detected", {
            file: filePath.slice(-60),
            missing: this.missingDependencies.length,
            details: this.missingDependencies,
        });
        throw toError(createError({
            type: "build",
            message: `Component has missing dependencies:\n${missingList}`,
            context: {
                file: filePath,
                phase: "dependency-resolution",
                missing: this.missingDependencies,
            },
        }));
    }
    getCacheKey(filePath) {
        if (!this.options.contentSourceId) {
            throw new Error(`Missing contentSourceId for SSR module cache (project: ${this.options.projectId}, file: ${filePath})`);
        }
        return buildSSRModuleCacheKey(TRANSFORM_CACHE_VERSION, this.options.projectId, `${this.options.contentSourceId}:${filePath}`);
    }
    isProductionContentSource() {
        const sourceId = this.options.contentSourceId;
        if (!sourceId) {
            return !this.options.dev;
        }
        if (sourceId.startsWith("preview-") || sourceId === "preview" || sourceId === "preview-draft") {
            return false;
        }
        if (sourceId.startsWith("release-") ||
            sourceId.startsWith("production-") ||
            sourceId.startsWith("prod-") ||
            sourceId === "production") {
            return true;
        }
        return !this.options.dev;
    }
    getRegistryBaseUrl() {
        const apiBaseUrl = this.options.apiBaseUrl || getApiBaseUrlEnv();
        return apiBaseUrl.replace(/\/api\/?$/, "");
    }
    /**
     * Fetch and transform a cross-project import.
     */
    async transformCrossProjectImport(crossProjectImport) {
        const { specifier, projectSlug, version, path } = crossProjectImport;
        const cacheKey = specifier;
        const cachedEntry = globalCrossProjectCache.get(cacheKey);
        if (cachedEntry)
            return cachedEntry.tempPath;
        const registryBaseUrl = this.getRegistryBaseUrl();
        const projectRef = `${projectSlug}@${version}`;
        const registryUrl = `${registryBaseUrl}/${projectRef}/@/${path}`;
        logger.debug("[SSR-MODULE-LOADER] Fetching cross-project import", {
            specifier,
            registryUrl,
        });
        const controller = new AbortController();
        const timeout = dntShim.setTimeout(() => controller.abort(), 30000);
        try {
            const headers = new dntShim.Headers({
                Accept: "text/plain, application/javascript, */*",
            });
            injectContext(headers);
            const response = await dntShim.fetch(registryUrl, { signal: controller.signal, headers });
            clearTimeout(timeout);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${registryUrl}: ${response.status} ${response.statusText}`);
            }
            const sourceCode = await response.text();
            const contentHash = await this.hashContentAsync(sourceCode);
            const ext = path.match(/\.(tsx?|jsx?|mdx)$/)?.[0] ?? ".tsx";
            const syntheticFilePath = `cross-project/${projectRef}/@/${path}`;
            const tempPath = await this.getTempPath(syntheticFilePath, contentHash);
            await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });
            const useSemaphore = MAX_CONCURRENT_TRANSFORMS > 0;
            if (useSemaphore) {
                const acquired = await transformSemaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
                if (!acquired) {
                    throw new Error(`Transform capacity exceeded (${transformSemaphore.waiting} waiting). Service is overloaded.`);
                }
            }
            try {
                const transformOpts = {
                    projectId: this.options.projectId,
                    dev: this.options.dev,
                    ssr: true,
                    apiBaseUrl: this.options.apiBaseUrl,
                };
                const filePathWithExt = syntheticFilePath.endsWith(ext)
                    ? syntheticFilePath
                    : syntheticFilePath + ext;
                const transformed = await transformToESM(sourceCode, filePathWithExt, this.options.projectDir, this.options.adapter, transformOpts);
                await this.fs.writeTextFile(tempPath, transformed);
                globalCrossProjectCache.set(cacheKey, { tempPath, contentHash });
                logger.debug("[SSR-MODULE-LOADER] Cross-project import transformed", {
                    specifier,
                    tempPath,
                });
                return tempPath;
            }
            finally {
                if (useSemaphore)
                    transformSemaphore.release();
            }
        }
        catch (error) {
            clearTimeout(timeout);
            logger.error("[SSR-MODULE-LOADER] Failed to fetch cross-project import", {
                specifier,
                registryUrl,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    transformWithDependencies(filePath, source, depth = 0) {
        const fileName = filePath.split("/").pop() || filePath;
        return withSpan(SpanNames.SSR_TRANSFORM_DEPENDENCIES, () => this.doTransformWithDependencies(filePath, source, depth), {
            "ssr.file": fileName,
            "ssr.depth": depth,
        });
    }
    async doTransformWithDependencies(filePath, source, depth = 0) {
        if (depth > MAX_TRANSFORM_DEPTH) {
            logger.warn("[SSR-MODULE-LOADER] Max transform depth exceeded", {
                file: filePath.slice(-40),
                depth,
                maxDepth: MAX_TRANSFORM_DEPTH,
            });
            throw toError(createError({
                type: "build",
                message: `Max transform depth exceeded (${MAX_TRANSFORM_DEPTH}, depth=${depth}) for ${filePath}. Check for circular dependencies.`,
                context: { file: filePath, phase: "transform" },
            }));
        }
        const code = source ?? (await this.options.adapter.fs.readFile(filePath));
        const contentHash = await this.hashContentAsync(code);
        const contentCacheKey = this.getCacheKey(`${filePath}:${contentHash}`);
        const filePathCacheKey = this.getCacheKey(filePath);
        // Use content hash in inProgressKey to prevent race condition where
        // different content versions wait for each other's transforms
        const inProgressKey = contentCacheKey;
        const cachedEntry = globalModuleCache.get(contentCacheKey);
        if (cachedEntry) {
            globalModuleCache.set(filePathCacheKey, cachedEntry);
            await this.ensureDependenciesExist(code, filePath, depth);
            return;
        }
        const redisEnabled = getRedisEnabled();
        const redisClient = getRedisClientInstance();
        if (redisEnabled && redisClient) {
            const redisCode = await getFromRedis(contentCacheKey);
            if (redisCode) {
                const tempPath = await this.getTempPath(filePath, contentHash);
                await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });
                await this.fs.writeTextFile(tempPath, redisCode);
                const entry = { tempPath, contentHash };
                globalModuleCache.set(contentCacheKey, entry);
                globalModuleCache.set(filePathCacheKey, entry);
                logger.debug("[SSR-MODULE-LOADER] Redis cache hit", { file: filePath.slice(-40) });
                await this.ensureDependenciesExist(code, filePath, depth);
                return;
            }
        }
        const existingTransform = globalInProgress.get(inProgressKey);
        if (existingTransform) {
            try {
                await withSpan(SpanNames.SSR_WAIT_IN_PROGRESS, () => withTimeoutThrow(existingTransform, IN_PROGRESS_WAIT_TIMEOUT_MS, `Waiting for in-progress transform of ${filePath}`), { "ssr.file": filePath.split("/").pop() || filePath });
                return;
            }
            catch (error) {
                globalInProgress.delete(inProgressKey);
                logger.warn("[SSR-MODULE-LOADER] In-progress transform timed out, retrying", {
                    file: filePath.slice(-40),
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        let resolveTransform;
        let rejectTransform;
        const transformPromise = new Promise((resolve, reject) => {
            resolveTransform = resolve;
            rejectTransform = reject;
        });
        globalInProgress.set(inProgressKey, transformPromise);
        try {
            const parseResult = await parseLocalImports(code, filePath, this.options.projectDir, this.options.adapter);
            if (parseResult.missing.length > 0) {
                this.missingDependencies.push(...parseResult.missing);
            }
            const crossProjectPaths = new Map();
            const localFs = createFileSystem();
            const localImportPaths = await this.processLocalImports(parseResult.imports, filePath, depth, localFs);
            for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
                const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
                await Promise.all(batch.map(async (crossImport) => {
                    try {
                        const tempPath = await this.transformCrossProjectImport(crossImport);
                        crossProjectPaths.set(crossImport.specifier, tempPath);
                    }
                    catch (error) {
                        this.missingDependencies.push({
                            specifier: crossImport.specifier,
                            fromFile: filePath,
                            reason: `Failed to fetch cross-project import: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    }
                }));
            }
            const useSemaphore = MAX_CONCURRENT_TRANSFORMS > 0;
            if (useSemaphore) {
                const acquired = await transformSemaphore.tryAcquire(TRANSFORM_ACQUIRE_TIMEOUT_MS);
                if (!acquired) {
                    throw toError(createError({
                        type: "build",
                        message: `Transform capacity exceeded (${transformSemaphore.waiting} waiting). Service is overloaded.`,
                        context: { file: filePath, phase: "transform" },
                    }));
                }
            }
            try {
                const transformOpts = {
                    projectId: this.options.projectId,
                    dev: this.options.dev,
                    ssr: true,
                    apiBaseUrl: this.options.apiBaseUrl,
                };
                let transformed = await withSpan(SpanNames.SSR_TRANSFORM_SINGLE, () => transformToESM(code, filePath, this.options.projectDir, this.options.adapter, transformOpts), { "ssr.file": filePath.split("/").pop() || filePath });
                for (const [specifier, tempPath] of crossProjectPaths.entries()) {
                    transformed = this.rewriteCrossProjectImport(transformed, specifier, tempPath);
                }
                // Rewrite local imports to use hashed temp paths
                // This ensures that each content version uses its own cached module
                transformed = this.rewriteLocalImports(transformed, localImportPaths, filePath);
                // Hash the TRANSFORMED content (after import rewrites) for cache busting
                // This ensures Deno's module cache is invalidated when dependencies change
                const transformedHash = await this.hashContentAsync(transformed);
                const tempPath = await this.getTempPath(filePath, transformedHash);
                await this.fs.mkdir(tempPath.substring(0, tempPath.lastIndexOf("/")), { recursive: true });
                await this.fs.writeTextFile(tempPath, transformed);
                if (redisEnabled && redisClient) {
                    setInRedis(contentCacheKey, transformed, {
                        isProduction: this.isProductionContentSource(),
                    }).catch(() => { });
                }
                // Use transformedHash for cache busting in dynamic imports
                const entry = { tempPath, contentHash: transformedHash };
                globalModuleCache.set(contentCacheKey, entry);
                globalModuleCache.set(filePathCacheKey, entry);
            }
            finally {
                if (useSemaphore)
                    transformSemaphore.release();
            }
            resolveTransform();
        }
        catch (error) {
            rejectTransform(error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
        finally {
            globalInProgress.delete(inProgressKey);
        }
    }
    /**
     * Process local imports and return a map of specifier -> hashed temp path
     * This allows the parent file to have its imports rewritten to the correct hashed paths.
     */
    async processLocalImports(imports, fromFilePath, depth, localFs) {
        const importPathMap = new Map();
        for (let i = 0; i < imports.length; i += TRANSFORM_BATCH_SIZE) {
            const batch = imports.slice(i, i + TRANSFORM_BATCH_SIZE);
            await Promise.all(batch.map(async (imp) => {
                try {
                    const useLocalFs = imp.absolutePath.startsWith("/");
                    const depSource = useLocalFs
                        ? await localFs.readTextFile(imp.absolutePath)
                        : await this.options.adapter.fs.readFile(imp.absolutePath);
                    await this.transformWithDependencies(imp.absolutePath, depSource, depth + 1);
                    // After transforming, get the cache entry to find the hashed temp path
                    const depCacheKey = this.getCacheKey(imp.absolutePath);
                    const depEntry = globalModuleCache.get(depCacheKey);
                    if (depEntry) {
                        importPathMap.set(imp.specifier, depEntry.tempPath);
                        importPathMap.set(imp.absolutePath, depEntry.tempPath);
                    }
                }
                catch (error) {
                    this.missingDependencies.push({
                        specifier: imp.specifier,
                        fromFile: fromFilePath,
                        reason: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            }));
        }
        return importPathMap;
    }
    rewriteCrossProjectImport(transformed, specifier, tempPath) {
        const jsSpecifier = specifier.replace(/\.(tsx?|jsx|mdx)$/, ".js");
        const escapedSpecifier = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escapedJsSpecifier = jsSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`from\\s*["'](${escapedSpecifier}|${escapedJsSpecifier})["']`, "g");
        return transformed.replace(pattern, `from "file://${tempPath}"`);
    }
    /**
     * Rewrite local imports to use hashed temp paths.
     * This ensures each content version uses its own cached module file.
     */
    rewriteLocalImports(transformed, localImportPaths, fromFilePath) {
        if (localImportPaths.size === 0)
            return transformed;
        const projectDir = this.options.projectDir.replace(/\/$/, "");
        const fromFileDir = fromFilePath.substring(0, fromFilePath.lastIndexOf("/"));
        const fromRelativeDir = fromFileDir.startsWith(projectDir)
            ? fromFileDir.substring(projectDir.length + 1)
            : fromFileDir;
        let result = transformed;
        for (const [specifierOrPath, tempPath] of localImportPaths.entries()) {
            const patterns = this.buildImportPatterns(specifierOrPath, fromRelativeDir, projectDir);
            for (const pattern of patterns) {
                const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const regex = new RegExp(`from\\s*["'](${escapedPattern})["']`, "g");
                result = result.replace(regex, `from "file://${tempPath}"`);
            }
        }
        return result;
    }
    /**
     * Build import patterns for a given specifier to match in transformed code.
     */
    buildImportPatterns(specifierOrPath, fromRelativeDir, projectDir) {
        // Handle @/ alias imports (e.g., @/components/Welcome)
        if (specifierOrPath.startsWith("@/")) {
            return this.buildAliasImportPatterns(specifierOrPath, fromRelativeDir);
        }
        // Handle absolute paths
        if (specifierOrPath.startsWith("/") || specifierOrPath.startsWith(projectDir)) {
            return this.buildAbsoluteImportPatterns(specifierOrPath, fromRelativeDir, projectDir);
        }
        // Handle relative imports (./foo, ../foo)
        if (specifierOrPath.startsWith("./") || specifierOrPath.startsWith("../")) {
            return this.buildRelativeImportPatterns(specifierOrPath);
        }
        return [];
    }
    buildAliasImportPatterns(specifier, fromRelativeDir) {
        const aliasPath = specifier.substring(2); // Remove @/
        const depth = fromRelativeDir.split("/").filter(Boolean).length;
        const relativePrefix = depth === 0 ? "./" : "../".repeat(depth);
        const patterns = [`${relativePrefix}${aliasPath}.js`];
        // Handle paths that already have an extension
        if (/\.(tsx?|jsx|mdx)$/.test(aliasPath)) {
            patterns.push(`${relativePrefix}${this.toJsExtension(aliasPath)}`);
        }
        return patterns;
    }
    buildAbsoluteImportPatterns(absolutePath, fromRelativeDir, projectDir) {
        const depRelativePath = absolutePath.startsWith(projectDir)
            ? absolutePath.substring(projectDir.length + 1)
            : absolutePath.substring(1);
        const lastSlash = depRelativePath.lastIndexOf("/");
        const depDir = depRelativePath.substring(0, lastSlash);
        const depFile = depRelativePath.substring(lastSlash + 1);
        const relativePath = this.computeRelativePath(fromRelativeDir, depDir, depFile);
        return [this.toJsExtension(relativePath)];
    }
    buildRelativeImportPatterns(specifier) {
        const jsPath = this.toJsExtension(specifier);
        const patterns = [jsPath];
        if (!jsPath.endsWith(".js")) {
            patterns.push(`${jsPath}.js`);
        }
        return patterns;
    }
    /**
     * Compute relative path from source directory to target file.
     */
    computeRelativePath(fromDir, toDir, fileName) {
        const fromParts = fromDir.split("/").filter(Boolean);
        const toParts = toDir.split("/").filter(Boolean);
        let commonPrefixLen = 0;
        while (commonPrefixLen < fromParts.length &&
            commonPrefixLen < toParts.length &&
            fromParts[commonPrefixLen] === toParts[commonPrefixLen]) {
            commonPrefixLen++;
        }
        const upCount = fromParts.length - commonPrefixLen;
        const downParts = toParts.slice(commonPrefixLen);
        if (upCount === 0 && downParts.length === 0) {
            return `./${fileName}`;
        }
        if (upCount === 0) {
            return `./${downParts.join("/")}/${fileName}`;
        }
        const upPath = "../".repeat(upCount);
        const downPath = downParts.length > 0 ? `${downParts.join("/")}/` : "";
        return `${upPath}${downPath}${fileName}`;
    }
    /**
     * Convert TypeScript/JSX extension to .js
     */
    toJsExtension(path) {
        return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
    }
    async ensureDependenciesExist(code, filePath, depth = 0) {
        if (depth > MAX_TRANSFORM_DEPTH)
            return;
        const parseResult = await parseLocalImports(code, filePath, this.options.projectDir, this.options.adapter);
        if (parseResult.missing.length > 0) {
            this.missingDependencies.push(...parseResult.missing);
        }
        const localFs = createFileSystem();
        await this.processLocalImports(parseResult.imports, filePath, depth, localFs);
        for (let i = 0; i < parseResult.crossProjectImports.length; i += TRANSFORM_BATCH_SIZE) {
            const batch = parseResult.crossProjectImports.slice(i, i + TRANSFORM_BATCH_SIZE);
            await Promise.all(batch.map(async (crossImport) => {
                try {
                    await this.transformCrossProjectImport(crossImport);
                }
                catch (error) {
                    this.missingDependencies.push({
                        specifier: crossImport.specifier,
                        fromFile: filePath,
                        reason: `Failed to fetch cross-project import: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            }));
        }
    }
    /**
     * Fast sync hash for small strings (project IDs, etc.)
     * Use hashContentAsync for large file content.
     */
    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }
    /**
     * Async hash for large content using Web Crypto API.
     * Doesn't block event loop for large files.
     */
    async hashContentAsync(content) {
        if (content.length < 10000)
            return this.hashCode(content);
        try {
            const data = new TextEncoder().encode(content);
            const hashBuffer = await dntShim.crypto.subtle.digest("SHA-256", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray
                .slice(0, 8)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        }
        catch {
            return this.hashCode(content);
        }
    }
    async getTempPath(filePath, contentHash) {
        const tmpDir = await this.ensureTmpDir();
        const projectDir = this.options.projectDir.replace(/\/$/, "");
        const relativePath = filePath.startsWith(projectDir)
            ? filePath.substring(projectDir.length)
            : filePath;
        // Include content hash in filename to ensure each content version gets a unique file
        // This prevents Deno's module cache from returning stale modules
        const hashSuffix = contentHash ? `.${contentHash.slice(0, 8)}` : "";
        const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `${hashSuffix}.js`);
        return join(tmpDir, jsPath);
    }
    async ensureTmpDir() {
        let projectDir = this.options.projectDir;
        const { projectId, contentSourceId } = this.options;
        if (!projectId) {
            throw new Error(`Missing projectId for SSR temp directory (projectDir: ${projectDir})`);
        }
        if (!contentSourceId) {
            throw new Error(`Missing contentSourceId for SSR temp directory (project: ${projectId})`);
        }
        if (!projectDir.startsWith("/")) {
            projectDir = join(cwd(), projectDir);
        }
        const cacheBaseDir = getCacheBaseDir();
        const baseDir = isAbsolute(cacheBaseDir) ? cacheBaseDir : join(cwd(), cacheBaseDir);
        const cacheKey = `${baseDir}|${buildSSRModuleProjectKey(projectDir, projectId)}|${contentSourceId}`;
        const existingDir = globalTmpDirs.get(cacheKey);
        if (existingDir)
            return existingDir;
        const projectKey = this.hashCode(projectId);
        const sourceKey = this.hashCode(contentSourceId);
        const tmpDir = join(baseDir, "veryfront-ssr", projectKey, sourceKey);
        await this.fs.mkdir(tmpDir, { recursive: true });
        globalTmpDirs.set(cacheKey, tmpDir);
        return tmpDir;
    }
}
