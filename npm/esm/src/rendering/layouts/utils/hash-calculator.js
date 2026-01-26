import { computeHash, rendererLogger as logger } from "../../../utils/index.js";
export async function computeDepsHash(layoutBundle, nestedLayouts, adapter) {
    try {
        const hashPromises = [];
        if (layoutBundle) {
            hashPromises.push(computeHash(String(layoutBundle.compiledCode ?? "")));
        }
        for (const item of nestedLayouts) {
            if (!item)
                continue;
            if (item.componentPath) {
                hashPromises.push(adapter.fs
                    .readFile(item.componentPath)
                    .then((src) => computeHash(src))
                    .catch((e) => {
                    logger.debug("[layout] reading tsx layout for dep hash failed", e);
                    return "";
                }));
                continue;
            }
            const compiledCode = item.bundle?.compiledCode;
            if (compiledCode) {
                hashPromises.push(computeHash(String(compiledCode)));
            }
        }
        const depParts = await Promise.all(hashPromises);
        return depParts.filter(Boolean).join(":");
    }
    catch (e) {
        logger.debug("[layout] dep hash computation failed", e);
        return "";
    }
}
