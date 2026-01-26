import { computeHash, rendererLogger as logger } from "../../utils/index.js";
import { compileMDXLayouts } from "./utils/compiler.js";
export class LayoutCompiler {
    adapter;
    compileMDX;
    constructor(options) {
        this.adapter = options.adapter;
        this.compileMDX = options.compileMDX;
    }
    async compileLayouts(layouts) {
        await compileMDXLayouts(layouts, this.compileMDX, this.adapter);
    }
    async computeDependencyHash(layoutBundle, nestedLayouts) {
        try {
            const depParts = [];
            if (layoutBundle) {
                depParts.push(await computeHash(String(layoutBundle.compiledCode ?? "")));
            }
            for (const item of nestedLayouts) {
                if (!item)
                    continue;
                if (item.componentPath) {
                    try {
                        const src = await this.adapter.fs.readFile(item.componentPath);
                        depParts.push(await computeHash(src));
                    }
                    catch (e) {
                        logger.debug("[LayoutCompiler] reading tsx layout for dep hash failed", e);
                    }
                    continue;
                }
                const compiledCode = item.bundle?.compiledCode;
                if (compiledCode) {
                    depParts.push(await computeHash(String(compiledCode)));
                }
            }
            return depParts.join(":");
        }
        catch (e) {
            logger.debug("[LayoutCompiler] dep hash computation failed", e);
            return "";
        }
    }
}
