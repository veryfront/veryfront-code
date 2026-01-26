import { checkDenoVersion, checkReactCompatibility } from "./version-checks.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { checkCacheSystem, checkConfiguration, checkProjectStructure, } from "./project-structure.js";
import { checkRSCCounters, checkRSCEndpoints, checkRSCFlag } from "./server-checks.js";
import { checkAIConfig } from "./ai-checks.js";
import { checkList } from "../../ui/components/table.js";
import { bold, error, success, warning } from "../../ui/colors.js";
function summarizeResults(results) {
    return results.reduce((acc, result) => {
        if (result.status === "warn")
            acc.warnCount++;
        if (result.status === "fail")
            acc.failCount++;
        return acc;
    }, { warnCount: 0, failCount: 0 });
}
export async function doctorCommand(projectDir, opts = {}) {
    const results = [
        await checkDenoVersion(),
        ...(await checkProjectStructure(projectDir)),
        await checkConfiguration(projectDir),
        await checkCacheSystem(),
        await checkReactCompatibility(),
        await checkRSCFlag(),
        ...(await checkRSCEndpoints()),
        await checkRSCCounters(),
        ...(await checkAIConfig(projectDir)),
    ];
    const checkItems = results.map((r) => ({
        label: r.name,
        status: r.status,
        detail: r.message,
    }));
    console.log();
    console.log(`  ${bold("System Diagnostics")}`);
    console.log();
    console.log(checkList(checkItems));
    console.log();
    const { warnCount, failCount } = summarizeResults(results);
    const passCount = results.length - warnCount - failCount;
    if (failCount > 0) {
        console.log(`  ${error("✗")} ${failCount} failed, ${warnCount} warnings, ${passCount} passed`);
        console.log();
        throw toError(createError({
            type: "config",
            message: `Doctor checks failed: ${failCount} failed, ${warnCount} warnings`,
        }));
    }
    if (warnCount > 0) {
        console.log(`  ${warning("!")} ${warnCount} warnings, ${passCount} passed`);
        console.log();
        if (opts.strict) {
            throw toError(createError({
                type: "config",
                message: `Doctor strict mode: ${warnCount} warning(s) present`,
            }));
        }
        return;
    }
    console.log(`  ${success("✓")} All ${passCount} checks passed`);
    console.log();
}
