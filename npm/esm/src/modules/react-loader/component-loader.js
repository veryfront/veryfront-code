import { join } from "../../platform/compat/path/index.js";
import { transformToESM } from "../../transforms/esm/index.js";
import { getProjectTmpDir } from "./temp-directory.js";
import { normalizeModulePath, resolveRelativePath } from "./path-resolver.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { SSRModuleLoader } from "./ssr-module-loader/index.js";
import { extractComponent } from "./extract-component.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
export function loadComponentFromSource(source, filePath, projectDir, adapter, options) {
    const fileName = filePath.split("/").pop() || filePath;
    return withSpan("modules.react.loadComponentFromSource", async () => {
        const projectId = options?.projectId ?? projectDir;
        const dev = options?.dev ?? true;
        const ssr = options?.ssr ?? true;
        if (ssr) {
            const loader = new SSRModuleLoader({
                projectDir,
                projectId,
                adapter,
                dev,
                contentSourceId: options?.contentSourceId,
                reactVersion: options?.reactVersion,
            });
            return loader.loadModule(filePath, source);
        }
        const transformOpts = {
            projectId,
            dev,
            moduleServerUrl: options?.moduleServerUrl ?? "/_vf_modules",
            vendorBundleHash: options?.vendorBundleHash,
            ssr: false,
            reactVersion: options?.reactVersion,
        };
        const transformedCode = await transformToESM(source, filePath, projectDir, adapter, transformOpts);
        const tmpDir = await getProjectTmpDir(projectId);
        const relativeFilePath = resolveRelativePath(filePath, projectDir);
        const componentFile = join(tmpDir, normalizeModulePath(relativeFilePath));
        const componentDir = componentFile.substring(0, componentFile.lastIndexOf("/"));
        const fs = createFileSystem();
        await fs.mkdir(componentDir, { recursive: true });
        await fs.writeTextFile(componentFile, transformedCode);
        const mod = await import(`file://${componentFile}?t=${Date.now()}`);
        return extractComponent(mod, filePath);
    }, {
        "react.file": fileName,
        "react.projectDir": projectDir,
        "react.ssr": options?.ssr ?? true,
        "react.sourceLength": source.length,
    });
}
