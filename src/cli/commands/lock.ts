/**
 * Lock command for managing remote import lockfile
 *
 * @module cli/commands/lock
 */

import { cliLogger } from "@veryfront/utils";
import { createLockfileManager } from "@veryfront/utils/import-lockfile.ts";
import { createSpinner, logSuccess, logWarning, confirmPrompt } from "../utils/index.ts";

interface LockOptions {
  projectDir: string;
  update?: boolean;
  verify?: boolean;
  clear?: boolean;
  list?: boolean;
  force?: boolean;
}

export async function lockCommand(options: LockOptions): Promise<void> {
  const { projectDir, update = false, verify = false, clear = false, list = false, force = false } = options;

  const lockfile = createLockfileManager(projectDir);

  if (list) {
    await listLockfile(lockfile);
    return;
  }

  if (clear) {
    if (!force) {
      const confirmed = await confirmPrompt(
        "Are you sure you want to clear the lockfile?",
        false
      );
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
    await updateLockfile(lockfile, projectDir);
    return;
  }

  await listLockfile(lockfile);
}

async function listLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const data = await lockfile.read();

  if (!data || Object.keys(data.imports).length === 0) {
    cliLogger.info("No lockfile entries found.");
    cliLogger.info("Remote imports will be locked automatically when you run 'veryfront dev'.");
    return;
  }

  cliLogger.info(`Lockfile contains ${Object.keys(data.imports).length} entries:\n`);

  for (const [url, entry] of Object.entries(data.imports)) {
    cliLogger.info(`  ${url}`);
    cliLogger.info(`    → ${entry.resolved}`);
    cliLogger.info(`    ✓ ${entry.integrity.slice(0, 20)}...`);
    if (entry.fetchedAt) {
      cliLogger.info(`    @ ${entry.fetchedAt}`);
    }
    cliLogger.info("");
  }
}

async function clearLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const spinner = createSpinner("Clearing lockfile...");
  spinner.start();

  try {
    await lockfile.clear();
    spinner.stop();
    logSuccess("Lockfile cleared successfully.");
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

async function verifyLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const data = await lockfile.read();

  if (!data || Object.keys(data.imports).length === 0) {
    cliLogger.info("No lockfile entries to verify.");
    return;
  }

  const spinner = createSpinner("Verifying lockfile entries...");
  spinner.start();

  let verified = 0;
  let failed = 0;
  const failures: Array<{ url: string; reason: string }> = [];

  const { computeIntegrity } = await import("@veryfront/utils/import-lockfile.ts");

  for (const [url, entry] of Object.entries(data.imports)) {
    try {
      const response = await fetch(entry.resolved, {
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
      } else {
        verified++;
      }
    } catch (error) {
      failed++;
      failures.push({ url, reason: String(error) });
    }
  }

  spinner.stop();

  if (failed === 0) {
    logSuccess(`All ${verified} entries verified successfully.`);
  } else {
    logWarning(`Verified: ${verified}, Failed: ${failed}`);
    cliLogger.info("\nFailed entries:");
    for (const { url, reason } of failures) {
      cliLogger.info(`  ✗ ${url}`);
      cliLogger.info(`    ${reason}`);
    }
    cliLogger.info("\nRun 'veryfront lock --update' to refresh failed entries.");
  }
}

async function updateLockfile(
  lockfile: ReturnType<typeof createLockfileManager>,
  _projectDir: string
): Promise<void> {
  const data = await lockfile.read();

  if (!data || Object.keys(data.imports).length === 0) {
    cliLogger.info("No lockfile entries to update.");
    cliLogger.info("Run 'veryfront dev' to populate the lockfile.");
    return;
  }

  const spinner = createSpinner("Updating lockfile entries...");
  spinner.start();

  let updated = 0;
  let failed = 0;

  const { computeIntegrity } = await import("@veryfront/utils/import-lockfile.ts");

  for (const [url] of Object.entries(data.imports)) {
    try {
      const response = await fetch(url, {
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
    } catch {
      failed++;
    }
  }

  await lockfile.flush();
  spinner.stop();

  if (failed === 0) {
    logSuccess(`Updated ${updated} entries successfully.`);
  } else {
    logWarning(`Updated: ${updated}, Failed: ${failed}`);
  }
}
