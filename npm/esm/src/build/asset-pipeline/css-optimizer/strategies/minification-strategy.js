import { logger } from "../../../../utils/index.js";
import { basicMinify } from "../utils.js";
export class MinificationStrategy {
    name = "basic-minification";
    priority = 10;
    canProcess(options) {
        return options.enabled !== false && options.minify !== false;
    }
    process(content, filename, _options) {
        logger.debug(`Using basic minification for ${filename}`);
        return Promise.resolve({
            code: basicMinify(content),
            sourceMap: undefined,
        });
    }
}
