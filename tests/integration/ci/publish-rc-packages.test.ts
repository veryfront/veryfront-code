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
            'publish) printf "%s\\n" "$*" >> "$NPM_LOG"; case "$2" in *"/$FAILURE.tgz") [ -z "$FAILURE" ] || exit 37;; esac;;',
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
