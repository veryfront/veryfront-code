import { BUILD_ERROR_CATALOG } from "./build-errors.js";
import { CONFIG_ERROR_CATALOG } from "./config-errors.js";
import { DEPLOYMENT_ERROR_CATALOG } from "./deployment-errors.js";
import { DEV_ERROR_CATALOG } from "./dev-errors.js";
import { GENERAL_ERROR_CATALOG } from "./general-errors.js";
import { MODULE_ERROR_CATALOG } from "./module-errors.js";
import { ROUTE_ERROR_CATALOG } from "./route-errors.js";
import { RSC_ERROR_CATALOG } from "./rsc-errors.js";
import { RUNTIME_ERROR_CATALOG } from "./runtime-errors.js";
import { SERVER_ERROR_CATALOG } from "./server-errors.js";
export const ERROR_CATALOG = {
    ...CONFIG_ERROR_CATALOG,
    ...BUILD_ERROR_CATALOG,
    ...RUNTIME_ERROR_CATALOG,
    ...ROUTE_ERROR_CATALOG,
    ...MODULE_ERROR_CATALOG,
    ...SERVER_ERROR_CATALOG,
    ...RSC_ERROR_CATALOG,
    ...DEV_ERROR_CATALOG,
    ...DEPLOYMENT_ERROR_CATALOG,
    ...GENERAL_ERROR_CATALOG,
};
export function getErrorSolution(code) {
    return ERROR_CATALOG[code] ?? null;
}
export function searchErrors(query) {
    const lowerQuery = query.toLowerCase();
    return Object.values(ERROR_CATALOG).filter((error) => {
        if (error.title.toLowerCase().includes(lowerQuery))
            return true;
        if (error.message.toLowerCase().includes(lowerQuery))
            return true;
        return error.steps?.some((step) => step.toLowerCase().includes(lowerQuery)) ?? false;
    });
}
export { createErrorSolution, createSimpleError } from "./factory.js";
export { BUILD_ERROR_CATALOG, CONFIG_ERROR_CATALOG, DEPLOYMENT_ERROR_CATALOG, DEV_ERROR_CATALOG, GENERAL_ERROR_CATALOG, MODULE_ERROR_CATALOG, ROUTE_ERROR_CATALOG, RSC_ERROR_CATALOG, RUNTIME_ERROR_CATALOG, SERVER_ERROR_CATALOG, };
