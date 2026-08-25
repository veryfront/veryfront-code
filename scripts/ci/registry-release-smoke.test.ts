import { assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";

const wrapperPath = new URL("./registry-release-smoke.sh", import.meta.url)
  .pathname;
const installSmokePath = new URL(
  "../test/npm-install-smoke.sh",
  import.meta.url,
).pathname;
const decoder = new TextDecoder();

async function writeExecutable(path: string, source: string): Promise<void> {
  await Deno.writeTextFile(path, source);
  await Deno.chmod(path, 0o755);
}

async function workspacePackageNames(): Promise<string[]> {
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const names = ["veryfront"];
  for (const member of config.workspace as string[]) {
    if (!member.startsWith("./extensions/")) continue;
    const manifest = JSON.parse(
      await Deno.readTextFile(`${member}/deno.json`),
    );
    if (manifest.veryfront?.npm?.publish === false) continue;
    names.push(manifest.name);
    for (
      const runtimePackage of manifest.veryfront?.npm?.runtimePackages ?? []
    ) {
      names.push(runtimePackage.name);
    }
  }
  return names.sort();
}

describe("exact-version registry smoke", () => {
  it("dry-runs every co-published package at the requested exact version", async () => {
    const version = "1.2.3-rc.45";
    const output = await new Deno.Command("bash", {
      args: [wrapperPath],
      env: {
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        IS_STABLE: "false",
        NPM_CONFIG_REGISTRY: "https://registry.example.test/npm/",
        RC_VERSION: version,
        VF_NPM_SMOKE_DRY_RUN: "1",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(output.code, 0, decoder.decode(output.stderr));
    const specs = decoder.decode(output.stdout).trim().split("\n").filter(
      (line) => line.startsWith("REGISTRY_PACKAGE_SPEC="),
    ).map((line) => line.slice("REGISTRY_PACKAGE_SPEC=".length)).sort();
    assertEquals(
      specs,
      (await workspacePackageNames()).map((name) => `${name}@${version}`)
        .sort(),
    );
    assertEquals(specs.some((spec) => spec.endsWith("@latest")), false);
  });

  it("passes the exact package list and registry URL to the install smoke", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-registry-wrapper-" });
    const binDir = `${tempDir}/bin`;
    const invocationLog = `${tempDir}/invocation.log`;
    await Deno.mkdir(binDir);
    await writeExecutable(`${binDir}/deno`, "#!/bin/bash\nexit 0\n");
    await writeExecutable(
      `${binDir}/bash`,
      `#!/bin/bash
printf '%s\\n' "version=\${VF_NPM_REGISTRY_VERSION:-}" >"\$VF_INVOCATION_LOG"
printf '%s\\n' "registry=\${VF_NPM_REGISTRY_URL:-}" >>"\$VF_INVOCATION_LOG"
printf '%s\\n' "packages:" >>"\$VF_INVOCATION_LOG"
printf '%s' "\${VF_NPM_REGISTRY_PACKAGES:-}" >>"\$VF_INVOCATION_LOG"
`,
    );

    try {
      const version = "1.2.3-rc.45";
      const registryUrl = "https://registry.example.test/npm/";
      const output = await new Deno.Command("/bin/bash", {
        args: [wrapperPath],
        env: {
          GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
          IS_STABLE: "false",
          NPM_CONFIG_REGISTRY: registryUrl,
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          RC_VERSION: version,
          VF_INVOCATION_LOG: invocationLog,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      const lines = (await Deno.readTextFile(invocationLog)).trim().split("\n");
      assertEquals(lines[0], `version=${version}`);
      assertEquals(lines[1], `registry=${registryUrl}`);
      assertEquals(lines[2], "packages:");
      assertEquals(lines.slice(3).sort(), await workspacePackageNames());
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("installs registry packages and auth extension by exact spec without tarballs", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-registry-install-" });
    const binDir = `${tempDir}/bin`;
    const npmLog = `${tempDir}/npm.log`;
    const npmCount = `${tempDir}/npm.count`;
    await Deno.mkdir(binDir);
    await writeExecutable(
      `${binDir}/npm`,
      `#!/usr/bin/env bash
case "\${1:-}" in
  init | pkg) exit 0 ;;
  install)
    count=0
    if [ -f "\$VF_FAKE_NPM_COUNT" ]; then count="\$(cat "\$VF_FAKE_NPM_COUNT")"; fi
    count=\$((count + 1))
    printf '%s' "\$count" >"\$VF_FAKE_NPM_COUNT"
    printf 'registry=%s\\n' "\${NPM_CONFIG_REGISTRY:-}" >>"\$VF_FAKE_NPM_LOG"
    printf 'args=%s\\n' "\$*" >>"\$VF_FAKE_NPM_LOG"
    if [ "\$count" -eq 1 ]; then
      mkdir -p node_modules/jose
      exit 0
    fi
    exit 86
    ;;
esac
exit 0
`,
    );
    await writeExecutable(
      `${binDir}/node`,
      `#!/usr/bin/env bash
case "\$*" in
  *"--version"*) printf '%s\\n' "Veryfront CLI test" ;;
  *"UNEXPECTEDLY_LOADED"*)
    printf '%s\\n' "install @veryfront/ext-auth-jwt alongside veryfront" >&2
    exit 1
    ;;
esac
exit 0
`,
    );

    try {
      const version = "1.2.3-rc.45";
      const registryUrl = "https://registry.example.test/npm/";
      const output = await new Deno.Command("/bin/bash", {
        args: [installSmokePath],
        env: {
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          VF_FAKE_NPM_COUNT: npmCount,
          VF_FAKE_NPM_LOG: npmLog,
          VF_NPM_REGISTRY_PACKAGES:
            "veryfront\n@veryfront/ext-parser-babel\n@veryfront/ext-auth-jwt",
          VF_NPM_REGISTRY_URL: registryUrl,
          VF_NPM_REGISTRY_VERSION: version,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(output.code, 86);
      const log = await Deno.readTextFile(npmLog);
      assertStringIncludes(
        log,
        `args=install --no-fund --no-audit --silent --ignore-scripts veryfront@${version} @veryfront/ext-parser-babel@${version}`,
      );
      assertStringIncludes(
        log,
        `args=install --no-fund --no-audit --silent --ignore-scripts @veryfront/ext-auth-jwt@${version}`,
      );
      assertEquals(
        log.match(new RegExp(`registry=${registryUrl}`, "g"))?.length,
        2,
      );
      assertEquals(log.includes(".tgz"), false);
      assertEquals(log.includes("@latest"), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects credential-bearing registry URLs without leaking them", async () => {
    const credential = "must-not-appear";
    const output = await new Deno.Command("/bin/bash", {
      args: [installSmokePath],
      env: {
        VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-auth-jwt",
        VF_NPM_REGISTRY_URL:
          `https://registry-user:${credential}@registry.example.test/npm/`,
        VF_NPM_REGISTRY_VERSION: "1.2.3-rc.45",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    assertEquals(output.code, 1);
    assertEquals(stdout.includes(credential), false);
    assertEquals(stderr.includes(credential), false);
    assertStringIncludes(stderr, "registry URL authority is invalid");
  });

  it("classifies install and behavior failures without echoing details", async () => {
    for (
      const [status, classification] of [
        [20, "install"],
        [21, "behavior"],
      ] as const
    ) {
      const output = await new Deno.Command("bash", {
        args: [
          "-c",
          'source "$WRAPPER_PATH"; registry_smoke_failure_classification "$STATUS"',
        ],
        env: {
          STATUS: String(status),
          WRAPPER_PATH: wrapperPath,
          NPM_TOKEN: "must-not-appear",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(output.code, 0, decoder.decode(output.stderr));
      assertEquals(decoder.decode(output.stdout).trim(), classification);
      assertEquals(
        decoder.decode(output.stdout).includes("must-not-appear"),
        false,
      );
      assertEquals(
        decoder.decode(output.stderr).includes("must-not-appear"),
        false,
      );
    }
  });

  it("rejects a missing exact version before any registry lookup", async () => {
    const output = await new Deno.Command("bash", {
      args: [wrapperPath],
      env: { NPM_TOKEN: "must-not-appear" },
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = decoder.decode(output.stderr);
    assertEquals(output.code, 1);
    assertStringIncludes(stderr, "REGISTRY RELEASE FAIL [configuration]");
    assertEquals(stderr.includes("must-not-appear"), false);
  });
});
