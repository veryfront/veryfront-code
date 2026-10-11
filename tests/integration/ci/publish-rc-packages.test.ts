import { assertEquals } from "#veryfront/testing/assert.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("RC publication process", () => {
  for (const failure of ["", "a"]) {
    it(`runs per-package immutable guards and ${failure ? "stops before dependent/root" : "publishes dependency order"}`, async () => {
      await withTempDir(async (directory) => {
        const artifact = `${directory}/artifact`;
        const bin = `${directory}/bin`;
        const log = `${directory}/npm.log`;
        await Deno.mkdir(artifact);
        await Deno.mkdir(bin);
        await Deno.writeTextFile(log, "");
        const packages = [
          { name: "@veryfront/ext-a", file: "a.tgz", dependencies: {} },
          {
            name: "@veryfront/ext-b",
            file: "b.tgz",
            dependencies: { "@veryfront/ext-a": "0.1.0-rc.1" },
          },
          {
            name: "veryfront",
            file: "root.tgz",
            dependencies: { "@veryfront/ext-b": "0.1.0-rc.1" },
          },
        ];
        const paths = [];
        for (const [index, entry] of packages.entries()) {
          const path = `${directory}/package${index}`;
          paths.push(path);
          await Deno.mkdir(path);
          await Deno.writeTextFile(`${path}/package.json`, JSON.stringify(entry));
        }
        await Deno.writeTextFile(
          `${artifact}/manifest.json`,
          JSON.stringify({
            packages: packages.map((entry) => ({ ...entry, version: "0.1.0-rc.1" })),
          }),
        );
        await Deno.writeTextFile(
          `${bin}/npm`,
          [
            "#!/bin/sh",
            'case "$1" in',
            'dist-tag) echo "rc: 0.1.0-rc.0";;',
            'view) echo "npm error code E404" >&2; exit 1;;',
            'publish) echo "fixture publish"; printf "%s\\n" "$*" >> "$NPM_LOG"; case "$2" in *"/$FAILURE.tgz") [ -z "$FAILURE" ] || exit 37;; esac;;',
            "*) exit 90;;",
            "esac",
          ].join("\n"),
        );
        await Deno.chmod(`${bin}/npm`, 0o700);
        const result = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--frozen",
            "--allow-read",
            "--allow-write",
            "--allow-run=bash",
            "--allow-env",
            "scripts/ci/publish-rc-packages.ts",
            ...paths,
          ],
          env: {
            PATH: `${bin}:${Deno.env.get("PATH")}`,
            NPM_LOG: log,
            VERSION: "0.1.0-rc.1",
            GITHUB_SHA: "expected-head",
            NPM_PACK_DIR: artifact,
            FAILURE: failure,
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        const stdout = new TextDecoder().decode(result.stdout);
        assertEquals(stdout.includes("[@veryfront/ext-a] fixture publish"), true);
        assertEquals(result.success, failure === "", new TextDecoder().decode(result.stderr));
        const calls = (await Deno.readTextFile(log)).trim().split("\n");
        assertEquals(
          calls,
          packages.slice(0, failure ? 1 : 3).map((entry) =>
            `publish ${artifact}/${entry.file} --provenance --access public --tag rc`
          ),
        );
      });
    });
  }
});

describe("shared RC metadata recovery budget", () => {
  it("shares polling time across independent publisher shells", async () => {
    await withTempDir(async (directory) => {
      const file = `${directory}/budget.json`;
      await Deno.writeTextFile(file, '{"spent":0}');
      const statuses: number[] = [];
      const diagnostics: string[] = [];
      for (let index = 0; index < 2; index++) {
        const result = await new Deno.Command("bash", {
          args: [
            "-euo",
            "pipefail",
            "-c",
            [
              "source scripts/ci/publish-npm-packages.sh",
              "reads=0",
              'lookup_npm_git_head() { reads=$((reads + 1)); PUBLISHED_GIT_HEAD=""; if [ "$reads" -ge 3 ]; then PUBLISHED_GIT_HEAD="$GITHUB_SHA"; fi; }',
              "sleep() { :; }",
              "wait_for_npm_git_head veryfront",
            ].join("\n"),
          ],
          env: {
            NPM_GIT_HEAD_SHARED_BUDGET_FILE: file,
            NPM_GIT_HEAD_WAIT_TOTAL_SECONDS: "20",
            NPM_GIT_HEAD_WAIT_DELAY_SECONDS: "10",
            NPM_GIT_HEAD_WAIT_ATTEMPTS: "5",
            GITHUB_SHA: "expected-head",
            VERSION: "0.1.0-rc.1",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        statuses.push(result.code);
        diagnostics.push(
          new TextDecoder().decode(result.stderr).replaceAll(directory, "<fixture>"),
        );
      }
      assertEquals(statuses, [0, 1], diagnostics.join("\n"));
      assertEquals(JSON.parse(await Deno.readTextFile(file)).spent, 20);
    });
  });
});

describe("atomic metadata budget updates", () => {
  for (
    const [operation, amount, limit, expectedSpent, expectedStatuses] of [
      ["charge", "1", "0", 4, [0, 0, 0, 0]],
      ["reserve", "10", "20", 20, [0, 0, 2, 2]],
    ] as const
  ) {
    it(`serializes concurrent ${operation} updates without resetting the release counter`, async () => {
      await withTempDir(async (directory) => {
        const path = `${directory}/budget.json`;
        await Deno.writeTextFile(path, '{"spent":0}');
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            new Deno.Command(Deno.execPath(), {
              args: [
                "run",
                "--frozen",
                "--allow-read",
                "--allow-write",
                "scripts/ci/npm-metadata-budget.ts",
                operation,
                path,
                amount,
                limit,
              ],
              stdout: "piped",
              stderr: "piped",
            }).output()),
        );
        assertEquals(results.map((result) => result.code).sort(), [...expectedStatuses]);
        assertEquals(JSON.parse(await Deno.readTextFile(path)).spent, expectedSpent);
      });
    });
  }

  it("fails closed on corrupted shared state", async () => {
    await withTempDir(async (directory) => {
      const path = `${directory}/budget.json`;
      await Deno.writeTextFile(path, '{"spent":-1}');
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--frozen",
          "--allow-read",
          "--allow-write",
          "scripts/ci/npm-metadata-budget.ts",
          "read",
          path,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.success, false);
      assertEquals(await Deno.readTextFile(path), '{"spent":-1}');
    });
  });
});

describe("metadata budget remainder", () => {
  for (const [amount, status, spent] of [[5, 0, 180], [10, 2, 175]] as const) {
    it(`reserves ${amount}s only if the whole delay fits the remaining release budget`, async () => {
      await withTempDir(async (directory) => {
        const path = `${directory}/budget.json`;
        await Deno.writeTextFile(path, '{"spent":175}');
        const result = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--frozen",
            "--allow-read",
            "--allow-write",
            "scripts/ci/npm-metadata-budget.ts",
            "reserve",
            path,
            String(amount),
            "180",
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(result.code, status, new TextDecoder().decode(result.stderr));
        assertEquals(JSON.parse(await Deno.readTextFile(path)).spent, spent);
        assertEquals(new TextDecoder().decode(result.stdout).trim(), String(spent));
      });
    });
  }
});
