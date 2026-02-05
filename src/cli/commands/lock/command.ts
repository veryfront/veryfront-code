import { cliLogger } from "#veryfront/utils";
import { createLockfileManager } from "#veryfront/utils/import-lockfile.ts";
import { confirmPrompt, logSuccess, logWarning } from "../../utils/index.ts";
import { createSpinner } from "../../ui/progress.ts";

export interface LockOptions {
  projectDir: string;
  update?: boolean;
  verify?: boolean;
  clear?: boolean;
  list?: boolean;
  force?: boolean;
}

export async function lockCommand(options: LockOptions): Promise<void> {
  const { projectDir, update = false, verify = false, clear = false, list = false, force = false } =
    options;

  const lockfile = createLockfileManager(projectDir);

  if (list) return listLockfile(lockfile);
  if (clear) return clearLockfileWithConfirm(lockfile, force);
  if (verify) return verifyLockfile(lockfile);
  if (update) return updateLockfile(lockfile);

  await listLockfile(lockfile);
}

async function clearLockfileWithConfirm(
  lockfile: ReturnType<typeof createLockfileManager>,
  force: boolean,
): Promise<void> {
  if (!force) {
    const confirmed = await confirmPrompt("Are you sure you want to clear the lockfile?", false);
    if (!confirmed) {
      cliLogger.info("Clear operation cancelled.");
      return;
    }
  }

  await clearLockfile(lockfile);
}

async function listLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const imports = (await lockfile.read())?.imports ?? {};
  const entries = Object.entries(imports);

  if (entries.length === 0) {
    cliLogger.info("No lockfile entries found.");
    cliLogger.info("Remote imports will be locked automatically when you run 'veryfront dev'.");
    return;
  }

  cliLogger.info(`Lockfile contains ${entries.length} entries:\n`);

  for (const [url, entry] of entries) {
    cliLogger.info(`  ${url}`);
    cliLogger.info(`    → ${entry.resolved}`);
    cliLogger.info(`    ✓ ${entry.integrity.slice(0, 20)}...`);
    if (entry.fetchedAt) cliLogger.info(`    @ ${entry.fetchedAt}`);
    cliLogger.info("");
  }
}

async function clearLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const spinner = createSpinner("Clearing lockfile...");

  try {
    await lockfile.clear();
    logSuccess("Lockfile cleared successfully.");
  } finally {
    spinner.stop();
  }
}

async function verifyLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const imports = (await lockfile.read())?.imports ?? {};
  const entries = Object.entries(imports);

  if (entries.length === 0) {
    cliLogger.info("No lockfile entries to verify.");
    return;
  }

  const spinner = createSpinner("Verifying lockfile entries...");

  let verified = 0;
  let failed = 0;
  const failures: Array<{ url: string; reason: string }> = [];

  const { computeIntegrity } = await import("#veryfront/utils/import-lockfile.ts");

  try {
    for (const [url, entry] of entries) {
      try {
        const response = await fetch(entry.resolved, {
          headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
        });

        if (!response.ok) {
          failed++;
          failures.push({ url, reason: `HTTP ${response.status}` });
          continue;
        }

        const integrity = await computeIntegrity(await response.text());

        if (integrity !== entry.integrity) {
          failed++;
          failures.push({ url, reason: "Integrity mismatch" });
          continue;
        }

        verified++;
      } catch (error) {
        failed++;
        failures.push({ url, reason: String(error) });
      }
    }
  } finally {
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

async function updateLockfile(lockfile: ReturnType<typeof createLockfileManager>): Promise<void> {
  const imports = (await lockfile.read())?.imports ?? {};
  const urls = Object.keys(imports);

  if (urls.length === 0) {
    cliLogger.info("No lockfile entries to update.");
    cliLogger.info("Run 'veryfront dev' to populate the lockfile.");
    return;
  }

  const spinner = createSpinner("Updating lockfile entries...");

  let updated = 0;
  let failed = 0;

  const { computeIntegrity } = await import("#veryfront/utils/import-lockfile.ts");

  try {
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
          redirect: "follow",
        });

        if (!response.ok) {
          failed++;
          continue;
        }

        const integrity = await computeIntegrity(await response.text());

        await lockfile.set(url, {
          resolved: response.url || url,
          integrity,
          fetchedAt: new Date().toISOString(),
        });

        updated++;
      } catch {
        failed++;
      }
    }

    await lockfile.flush();
  } finally {
    spinner.stop();
  }

  if (failed === 0) {
    logSuccess(`Updated ${updated} entries successfully.`);
    return;
  }

  logWarning(`Updated: ${updated}, Failed: ${failed}`);
}
