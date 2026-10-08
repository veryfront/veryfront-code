export interface PackageEntry {
  name: string;
  directory: string;
  dependencies: string[];
}

/** Publish independent extensions together; keep dependency barriers and root last. */
export async function publishPackages(
  entries: PackageEntry[],
  publish: (entry: PackageEntry) => Promise<void>,
): Promise<void> {
  const names = new Set(entries.map((entry) => entry.name));
  if (names.size !== entries.length || !names.has("veryfront")) {
    throw new Error(
      "RC publication requires unique packages and one veryfront root",
    );
  }
  const remaining = entries.map((entry) => ({
    ...entry,
    dependencies: entry.name === "veryfront"
      ? [...names].filter((name) => name !== "veryfront")
      : entry.dependencies.filter((name) => names.has(name)),
  }));
  const planned = new Set<string>();
  const batches: PackageEntry[][] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((entry) =>
      entry.dependencies.every((name) => planned.has(name))
    );
    if (ready.length === 0) {
      throw new Error("Cyclic first-party publication dependencies");
    }
    for (let index = 0; index < ready.length; index += 4) {
      batches.push(ready.slice(index, index + 4));
    }
    for (const entry of ready) {
      planned.add(entry.name);
      remaining.splice(remaining.indexOf(entry), 1);
    }
  }
  for (const batch of batches) {
    const results = await Promise.allSettled(batch.map(publish));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}

if (import.meta.main) {
  const entries: PackageEntry[] = [];
  for (const directory of Deno.args) {
    const manifest = JSON.parse(
      await Deno.readTextFile(`${directory}/package.json`),
    );
    if (typeof manifest.name !== "string" || !manifest.name) {
      throw new Error("Invalid package name");
    }
    entries.push({
      name: manifest.name,
      directory,
      dependencies: Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
      }),
    });
  }
  await publishPackages(entries, async ({ name, directory }) => {
    const status = await new Deno.Command("bash", {
      args: [
        "-euo",
        "pipefail",
        "-c",
        'source scripts/ci/publish-npm-packages.sh; run_rc_publish_package "$1"',
        "rc-package",
        directory,
      ],
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn().status;
    if (!status.success) {
      throw new Error(
        `RC publication failed for ${name} (status ${status.code})`,
      );
    }
  });
}
