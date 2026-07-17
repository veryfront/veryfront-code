/**
 * Test-file typecheck ratchet.
 *
 * CI's typecheck leg only covers source entry points and test runs use
 * --no-check, so type errors in *.test.ts(x) are invisible — latent call-
 * signature rot accumulates silently (426 errors across 113 files at the
 * time this baseline was cut). This gate typechecks every test file and
 * compares the set of FAILING FILES against the committed baseline:
 *
 *  - a failing file not in the baseline fails the gate (no new rot);
 *  - a baseline file that now passes fails the gate until it is removed
 *    from the baseline (shrink-only ratchet).
 */
const decoder = new TextDecoder();

function listTestFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(path);
    }
  };
  walk(root);
  return out;
}

const testFiles = [...listTestFiles("src"), ...listTestFiles("cli")].sort();
const command = new Deno.Command(Deno.execPath(), {
  args: ["check", "--no-lock", ...testFiles],
  stdout: "piped",
  stderr: "piped",
});
const result = command.outputSync();
const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
const plain = output.replace(/\x1b\[[0-9;]*m/g, "");

const failing = new Set<string>();
for (const match of plain.matchAll(/file:\/\/[^\s:]+?\/((?:src|cli)\/[^\s:]+\.test\.tsx?)/g)) {
  failing.add(match[1]);
}

const baseline = new Set<string>(
  JSON.parse(Deno.readTextFileSync("scripts/lint/test-typecheck-baseline.json")) as string[],
);

const newRot = [...failing].filter((file) => !baseline.has(file)).sort();
const fixed = [...baseline].filter((file) => !failing.has(file)).sort();

if (newRot.length > 0) {
  console.error(`Test files with NEW type errors (not in baseline):\n  ${newRot.join("\n  ")}`);
  console.error("Fix the type errors, or run `deno check --no-lock <file>` to see them.");
  Deno.exit(1);
}
if (fixed.length > 0) {
  console.error(
    `Baseline test files now typecheck cleanly — remove them from scripts/lint/test-typecheck-baseline.json to lock it in:\n  ${
      fixed.join("\n  ")
    }`,
  );
  Deno.exit(1);
}
console.log(`Test typecheck baseline holds: ${failing.size} grandfathered files, 0 new.`);
