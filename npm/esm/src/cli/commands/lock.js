import * as dntShim from "../../../_dnt.shims.js";
import { cliLogger } from "../../utils/index.js";
import { createLockfileManager } from "../../utils/import-lockfile.js";
import { confirmPrompt, createSpinner, logSuccess, logWarning } from "../utils/index.js";
export async function lockCommand(options) {
    const { projectDir, update = false, verify = false, clear = false, list = false, force = false, } = options;
    const lockfile = createLockfileManager(projectDir);
    if (list) {
        await listLockfile(lockfile);
        return;
    }
    if (clear) {
        if (!force) {
            const confirmed = await confirmPrompt("Are you sure you want to clear the lockfile?", false);
            if (!confirmed) {
                cliLogger.info("Clear operation cancelled.");
                return;
            }
        }
        await clearLockfile(lockfile);
        return;
    }
    if (verify) {
        await verifyLockfile(lockfile);
        return;
    }
    if (update) {
        await updateLockfile(lockfile);
        return;
    }
    await listLockfile(lockfile);
}
async function listLockfile(lockfile) {
    const data = await lockfile.read();
    const imports = data?.imports ?? {};
    if (Object.keys(imports).length === 0) {
        cliLogger.info("No lockfile entries found.");
        cliLogger.info("Remote imports will be locked automatically when you run 'veryfront dev'.");
        return;
    }
    cliLogger.info(`Lockfile contains ${Object.keys(imports).length} entries:\n`);
    for (const [url, entry] of Object.entries(imports)) {
        cliLogger.info(`  ${url}`);
        cliLogger.info(`    → ${entry.resolved}`);
        cliLogger.info(`    ✓ ${entry.integrity.slice(0, 20)}...`);
        if (entry.fetchedAt)
            cliLogger.info(`    @ ${entry.fetchedAt}`);
        cliLogger.info("");
    }
}
async function clearLockfile(lockfile) {
    const spinner = createSpinner("Clearing lockfile...");
    spinner.start();
    try {
        await lockfile.clear();
        logSuccess("Lockfile cleared successfully.");
    }
    finally {
        spinner.stop();
    }
}
async function verifyLockfile(lockfile) {
    const data = await lockfile.read();
    const imports = data?.imports ?? {};
    if (Object.keys(imports).length === 0) {
        cliLogger.info("No lockfile entries to verify.");
        return;
    }
    const spinner = createSpinner("Verifying lockfile entries...");
    spinner.start();
    let verified = 0;
    let failed = 0;
    const failures = [];
    const { computeIntegrity } = await import("../../utils/import-lockfile.js");
    try {
        for (const [url, entry] of Object.entries(imports)) {
            try {
                const response = await dntShim.fetch(entry.resolved, {
                    headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
                });
                if (!response.ok) {
                    failed++;
                    failures.push({ url, reason: `HTTP ${response.status}` });
                    continue;
                }
                const content = await response.text();
                const integrity = await computeIntegrity(content);
                if (integrity !== entry.integrity) {
                    failed++;
                    failures.push({ url, reason: "Integrity mismatch" });
                    continue;
                }
                verified++;
            }
            catch (error) {
                failed++;
                failures.push({ url, reason: String(error) });
            }
        }
    }
    finally {
        spinner.stop();
    }
    if (failed === 0) {
        logSuccess(`All ${verified} entries verified successfully.`);
        return;
    }
    logWarning(`Verified: ${verified}, Failed: ${failed}`);
    cliLogger.info("\nFailed entries:");
    for (const { url, reason } of failures) {
        cliLogger.info(`  ✗ ${url}`);
        cliLogger.info(`    ${reason}`);
    }
    cliLogger.info("\nRun 'veryfront lock --update' to refresh failed entries.");
}
async function updateLockfile(lockfile) {
    const data = await lockfile.read();
    const imports = data?.imports ?? {};
    if (Object.keys(imports).length === 0) {
        cliLogger.info("No lockfile entries to update.");
        cliLogger.info("Run 'veryfront dev' to populate the lockfile.");
        return;
    }
    const spinner = createSpinner("Updating lockfile entries...");
    spinner.start();
    let updated = 0;
    let failed = 0;
    const { computeIntegrity } = await import("../../utils/import-lockfile.js");
    try {
        for (const url of Object.keys(imports)) {
            try {
                const response = await dntShim.fetch(url, {
                    headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
                    redirect: "follow",
                });
                if (!response.ok) {
                    failed++;
                    continue;
                }
                const content = await response.text();
                const resolvedUrl = response.url || url;
                const integrity = await computeIntegrity(content);
                await lockfile.set(url, {
                    resolved: resolvedUrl,
                    integrity,
                    fetchedAt: new Date().toISOString(),
                });
                updated++;
            }
            catch {
                failed++;
            }
        }
        await lockfile.flush();
    }
    finally {
        spinner.stop();
    }
    if (failed === 0) {
        logSuccess(`Updated ${updated} entries successfully.`);
        return;
    }
    logWarning(`Updated: ${updated}, Failed: ${failed}`);
}
