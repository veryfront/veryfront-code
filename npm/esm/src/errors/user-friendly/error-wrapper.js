import { red } from "../../platform/compat/console/index.js";
import { exit } from "../../platform/compat/process.js";
import { cliLogger } from "../../utils/logger/logger.js";
import { formatUserError } from "./error-formatter.js";
export function wrapErrorHandler(fn) {
    return async (...args) => {
        try {
            return await fn(...args);
        }
        catch (error) {
            if (error instanceof Error) {
                cliLogger.error(formatUserError(error));
            }
            else {
                cliLogger.error(red("✖ Unknown error:"), error);
            }
            if (globalThis[Symbol.for("import-meta-ponyfill-esmodule")](import.meta).main)
                exit(1);
            throw error;
        }
    };
}
