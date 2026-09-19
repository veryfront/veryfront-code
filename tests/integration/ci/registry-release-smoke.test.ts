import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";

const wrapperPath = new URL(
  "../../../scripts/ci/registry-release-smoke.sh",
  import.meta.url,
)
  .pathname;
const installSmokePath = new URL(
  "../../../scripts/test/npm-install-smoke.ts",
  import.meta.url,
).pathname;
const repoRoot = new URL("../../../", import.meta.url);
const decoder = new TextDecoder();

async function writeExecutable(path: string, source: string): Promise<void> {
  await Deno.writeTextFile(path, source);
  await Deno.chmod(path, 0o755);
}

/**
 * Preamble for a stubbed `npm` that honours npm's logging contract: `--silent`
 * (alias of `--loglevel silent`) suppresses every stream, while any other
 * level lets error output through. Without this, a stub prints regardless of
 * the flags it is handed and cannot observe a caller that silences npm.
 */
const NPM_STUB_LOGLEVEL_PREAMBLE = `
vf_loglevel=notice
vf_take_next=0
for vf_arg in "\$@"; do
  if [ "\$vf_take_next" -eq 1 ]; then
    vf_loglevel="\$vf_arg"
    vf_take_next=0
    continue
  fi
  case "\$vf_arg" in
    --silent | -s) vf_loglevel=silent ;;
    --quiet | -q) vf_loglevel=warn ;;
    --loglevel) vf_take_next=1 ;;
    --loglevel=*) vf_loglevel="\${vf_arg#--loglevel=}" ;;
  esac
done

vf_say_error() {
  if [ "\$vf_loglevel" != "silent" ]; then
    printf '%s\\n' "\$1" >&2
  fi
}

vf_say_summary() {
  if [ "\$vf_loglevel" != "silent" ]; then
    printf '%s\\n' "\$1"
  fi
}
`;

async function workspacePackageNames(): Promise<string[]> {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", repoRoot)),
  );
  const names = ["veryfront"];
  for (const member of config.workspace as string[]) {
    if (!member.startsWith("./extensions/")) continue;
    const manifest = JSON.parse(
      await Deno.readTextFile(new URL(`${member}/deno.json`, repoRoot)),
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
  it("runs the behavior journey against the scaffold shipped by the installed package", async () => {
    const source = await Deno.readTextFile(installSmokePath);

    assertStringIncludes(source, "template: 'ai-agent'");
    assertStringIncludes(source, "await writeFile(target, file.content)");
    assertEquals(
      source.includes('cp -R "$ROOT_DIR/templates/files/ai-agent/."'),
      false,
    );
  });

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
    const tempDir = await makeTempDir({ prefix: "vf-registry-wrapper-" });
    const binDir = `${tempDir}/bin`;
    const invocationLog = `${tempDir}/invocation.log`;
    await Deno.mkdir(binDir);
    await writeExecutable(
      `${binDir}/deno`,
      `#!/bin/bash
case "\$*" in
  *npm-install-smoke.ts*)
    printf '%s\\n' "version=\${VF_NPM_REGISTRY_VERSION:-}" >"\$VF_INVOCATION_LOG"
    printf '%s\\n' "registry=\${VF_NPM_REGISTRY_URL:-}" >>"\$VF_INVOCATION_LOG"
    printf '%s\\n' "packages:" >>"\$VF_INVOCATION_LOG"
    printf '%s' "\${VF_NPM_REGISTRY_PACKAGES:-}" >>"\$VF_INVOCATION_LOG"
    ;;
esac
exit 0
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
    const tempDir = await makeTempDir({ prefix: "vf-registry-install-" });
    const binDir = `${tempDir}/bin`;
    const npmLog = `${tempDir}/npm.log`;
    const npmCount = `${tempDir}/npm.count`;
    await Deno.mkdir(binDir);
    await writeExecutable(`${binDir}/deno`, "#!/bin/bash\nexit 0\n");
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
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", installSmokePath],
        env: {
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          VF_FAKE_NPM_COUNT: npmCount,
          VF_FAKE_NPM_LOG: npmLog,
          VF_NPM_REGISTRY_PACKAGES:
            "veryfront\n@example/runtime-kit\n@veryfront/ext-parser-babel\n@veryfront/ext-auth-jwt",
          VF_NPM_REGISTRY_URL: registryUrl,
          VF_NPM_REGISTRY_VERSION: version,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(output.code, 20);
      const log = await Deno.readTextFile(npmLog);
      assertStringIncludes(
        log,
        `args=install --no-fund --no-audit --loglevel=error --ignore-scripts --prefer-online veryfront@${version} @example/runtime-kit@${version} @veryfront/ext-parser-babel@${version}`,
      );
      assertStringIncludes(
        log,
        `args=install --no-fund --no-audit --loglevel=error --ignore-scripts --prefer-online @veryfront/ext-auth-jwt@${version}`,
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

  it("returns the behavior classification after a successful registry install", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-registry-behavior-" });
    const binDir = `${tempDir}/bin`;
    await Deno.mkdir(binDir);
    await writeExecutable(`${binDir}/npm`, "#!/bin/bash\nexit 0\n");
    await writeExecutable(`${binDir}/node`, "#!/bin/bash\nexit 1\n");

    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", installSmokePath],
        env: {
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          VF_NPM_REGISTRY_PACKAGES:
            "veryfront\n@veryfront/ext-parser-babel\n@veryfront/ext-auth-jwt",
          VF_NPM_REGISTRY_URL: "https://registry.example.test/npm/",
          VF_NPM_REGISTRY_VERSION: "1.2.3-rc.45",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(output.code, 21);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not expose an absolute artifact path when the artifact is missing", async () => {
    const privatePath = new URL("missing-npm-artifact", import.meta.url)
      .pathname;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", installSmokePath],
      env: { VF_NPM_PACK_DIR: privatePath },
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = decoder.decode(output.stderr);
    assertEquals(output.code, 1);
    assertStringIncludes(stderr, "canonical npm artifact directory missing");
    assertEquals(stderr.includes(privatePath), false);
  });

  it("rejects credential-bearing registry URLs without leaking them", async () => {
    const credential = "must-not-appear";
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", installSmokePath],
      env: {
        VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-auth-jwt",
        VF_NPM_REGISTRY_URL: `https://registry-user:${credential}@registry.example.test/npm/`,
        VF_NPM_REGISTRY_VERSION: "1.2.3-rc.45",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    assertEquals(output.code, 22);
    assertEquals(stdout.includes(credential), false);
    assertEquals(stderr.includes(credential), false);
    assertStringIncludes(stderr, "registry URL authority is invalid");
  });

  it("classifies configuration, install, and behavior failures without echoing details", async () => {
    for (
      const [status, classification] of [
        [22, "configuration"],
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

  it("emits phase-specific smoke classifications from the wrapper", async () => {
    for (
      const [status, classification] of [
        [22, "configuration"],
        [20, "install"],
        [21, "behavior"],
      ] as const
    ) {
      const tempDir = await makeTempDir({ prefix: "vf-registry-phase-" });
      const binDir = `${tempDir}/bin`;
      await Deno.mkdir(binDir);
      await writeExecutable(
        `${binDir}/deno`,
        `#!/bin/bash
case "\$*" in
  *npm-install-smoke.ts*) exit ${status} ;;
esac
exit 0
`,
      );

      try {
        const output = await new Deno.Command("/bin/bash", {
          args: [wrapperPath],
          env: {
            GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
            IS_STABLE: "false",
            PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
            RC_VERSION: "1.2.3-rc.45",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();

        const stderr = decoder.decode(output.stderr);
        assertEquals(output.code, 1);
        assertStringIncludes(
          stderr,
          `Exact-version registry ${classification} smoke failed.`,
        );
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
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

  it("includes npm output and registry context in stderr when registry install fails", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-registry-install-diag-" });
    const binDir = `${tempDir}/bin`;
    await Deno.mkdir(binDir);
    await writeExecutable(`${binDir}/deno`, "#!/bin/bash\nexit 0\n");
    await writeExecutable(
      `${binDir}/npm`,
      `#!/usr/bin/env bash
${NPM_STUB_LOGLEVEL_PREAMBLE}
case "\${1:-}" in
  init | pkg) exit 0 ;;
  install)
    vf_say_error 'npm error 404 Not Found - registry-install-diagnostic-marker'
    exit 1
    ;;
esac
exit 0
`,
    );

    try {
      const version = "1.2.3-rc.45";
      // Only the public registry may be named verbatim; a private host is
      // redacted (see the private-registry test below).
      const registryUrl = "https://registry.npmjs.org/";
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", installSmokePath],
        env: {
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-auth-jwt",
          VF_NPM_REGISTRY_URL: registryUrl,
          VF_NPM_REGISTRY_VERSION: version,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      const stderr = decoder.decode(output.stderr);
      assertEquals(output.code, 20);
      assertStringIncludes(stderr, "registry-install-diagnostic-marker");
      assertStringIncludes(stderr, `registry=${registryUrl}`);
      assertStringIncludes(stderr, "specs=1");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("redacts _authToken values from npm output on registry install failure", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-registry-install-redact-" });
    const binDir = `${tempDir}/bin`;
    await Deno.mkdir(binDir);
    await writeExecutable(`${binDir}/deno`, "#!/bin/bash\nexit 0\n");
    await writeExecutable(
      `${binDir}/npm`,
      `#!/usr/bin/env bash
${NPM_STUB_LOGLEVEL_PREAMBLE}
case "\${1:-}" in
  init | pkg) exit 0 ;;
  install)
    vf_say_error 'npm error need auth //registry.example.test/npm/:_authToken=supersecret123'
    exit 1
    ;;
esac
exit 0
`,
    );

    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", installSmokePath],
        env: {
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-auth-jwt",
          VF_NPM_REGISTRY_URL: "https://registry.example.test/npm/",
          VF_NPM_REGISTRY_VERSION: "1.2.3-rc.45",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      const stderr = decoder.decode(output.stderr);
      assertEquals(output.code, 20);
      assertEquals(stderr.includes("supersecret123"), false);
      assertStringIncludes(stderr, "_authToken=<redacted>");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("redacts credentials and absolute paths from npm output on registry install failure", async () => {
    const tempDir = await makeTempDir({ prefix: "vf-registry-install-scrub-" });
    const binDir = `${tempDir}/bin`;
    await Deno.mkdir(binDir);
    await writeExecutable(`${binDir}/deno`, "#!/bin/bash\nexit 0\n");
    await writeExecutable(
      `${binDir}/npm`,
      `#!/usr/bin/env bash
${NPM_STUB_LOGLEVEL_PREAMBLE}
case "\${1:-}" in
  init | pkg) exit 0 ;;
  install)
    vf_say_error 'npm error code E401'
    vf_say_error 'npm error 401 Unauthorized - GET https://registry.example.test/npm/veryfront - authorization: Bearer header-must-not-appear'
    vf_say_error 'npm error request to https://registry.example.test/npm/veryfront?token=query-must-not-appear failed'
    vf_say_error 'npm error A complete log of this run can be found in: /home/npm-smoke-runner/.npm/_logs/2026-09-19T00_00_00_000Z-debug-0.log'
    exit 1
    ;;
esac
exit 0
`,
    );

    try {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", installSmokePath],
        env: {
          PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
          VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-auth-jwt",
          VF_NPM_REGISTRY_URL: "https://registry.example.test/npm/",
          VF_NPM_REGISTRY_VERSION: "1.2.3-rc.45",
        },
        stdout: "piped",
        stderr: "piped",
      }).output();

      const stderr = decoder.decode(output.stderr);
      assertEquals(output.code, 20);
      // The diagnosis itself must survive: redaction that eats the error code
      // returns the gate to the state this whole change exists to end.
      assertStringIncludes(stderr, "npm error code E401");
      assertEquals(stderr.includes("header-must-not-appear"), false);
      assertStringIncludes(stderr, "Bearer <redacted>");
      assertEquals(stderr.includes("query-must-not-appear"), false);
      assertStringIncludes(stderr, "token=<redacted>");
      assertEquals(stderr.includes("/home/npm-smoke-runner"), false);
      assertEquals(stderr.includes("A complete log of this run"), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("redacts a private registry host from the context line and npm output", async () => {
    const privateHost = "npm.private-mirror-must-not-appear.example.test";
    const stderr = await registryInstallFailureStderr(
      `https://${privateHost}:8443/npm/`,
      [
        "npm error code E404",
        `npm error 404 Not Found - GET https://${privateHost}:8443/npm/veryfront - private-registry-marker`,
        `npm error need auth //${privateHost.toUpperCase()}/npm/:_authToken=private-token-must-not-appear`,
      ],
    );

    assertEquals(stderr.includes("private-mirror-must-not-appear"), false);
    assertEquals(stderr.includes("PRIVATE-MIRROR-MUST-NOT-APPEAR"), false);
    assertEquals(stderr.includes("private-token-must-not-appear"), false);
    assertStringIncludes(stderr, "registry=<private-registry>");
    assertStringIncludes(stderr, "specs=1");
    // The diagnosis itself must survive the host redaction.
    assertStringIncludes(stderr, "npm error code E404");
    assertStringIncludes(
      stderr,
      "404 Not Found - GET https://<private-registry>/npm/veryfront - private-registry-marker",
    );
  });

  it("redacts token-only and repeated URL userinfo from npm output", async () => {
    const stderr = await registryInstallFailureStderr(
      "https://registry.npmjs.org/",
      [
        "npm error fetch https://tokenonly-must-not-appear@registry.npmjs.org/veryfront and https://user:pair-must-not-appear@registry.npmjs.org/jose failed",
        "npm error see https://registry.npmjs.org/veryfront?rev=a@b#frag-marker",
      ],
    );

    assertEquals(stderr.includes("tokenonly-must-not-appear"), false);
    assertEquals(stderr.includes("pair-must-not-appear"), false);
    assertStringIncludes(
      stderr,
      "https://<redacted>@registry.npmjs.org/veryfront and https://<redacted>@registry.npmjs.org/jose",
    );
    // An @ after the path, query or fragment is not userinfo and stays intact.
    assertStringIncludes(
      stderr,
      "https://registry.npmjs.org/veryfront?rev=a@b#frag-marker",
    );
  });
});

/** Run the registry install path against an npm stub that fails with `lines`. */
async function registryInstallFailureStderr(
  registryUrl: string,
  lines: string[],
): Promise<string> {
  const tempDir = await makeTempDir({ prefix: "vf-registry-install-host-" });
  const binDir = `${tempDir}/bin`;
  await Deno.mkdir(binDir);
  await writeExecutable(`${binDir}/deno`, "#!/bin/bash\nexit 0\n");
  const say = lines.map((line) => `    vf_say_error '${line}'`).join("\n");
  await writeExecutable(
    `${binDir}/npm`,
    `#!/usr/bin/env bash
${NPM_STUB_LOGLEVEL_PREAMBLE}
case "\${1:-}" in
  init | pkg) exit 0 ;;
  install)
${say}
    exit 1
    ;;
esac
exit 0
`,
  );

  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", installSmokePath],
      env: {
        PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
        VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-auth-jwt",
        VF_NPM_REGISTRY_URL: registryUrl,
        VF_NPM_REGISTRY_VERSION: "1.2.3-rc.45",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 20);
    return decoder.decode(output.stderr);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

const SKEW_VERSION = "1.2.3-rc.45";

/**
 * npm stub whose `install` replays one scripted failure per attempt, then
 * succeeds. Attempt N prints `$VF_FAKE_NPM_DIR/fail-N` and exits 1; a missing
 * file means the install succeeds. A failed attempt leaves a partial project
 * behind, and the next attempt records whether it saw that leftover, so a
 * retry that reuses a dirty project is observable.
 */
const SCRIPTED_INSTALL_NPM = `#!/usr/bin/env bash
${NPM_STUB_LOGLEVEL_PREAMBLE}
case "\${1:-}" in
  init | pkg) exit 0 ;;
  install)
    count=0
    if [ -f "\$VF_FAKE_NPM_DIR/count" ]; then count="\$(cat "\$VF_FAKE_NPM_DIR/count")"; fi
    count=\$((count + 1))
    printf '%s' "\$count" >"\$VF_FAKE_NPM_DIR/count"
    printf 'args=%s\\n' "\$*" >>"\$VF_FAKE_NPM_DIR/log"
    if [ -e node_modules/.partial-attempt ] || [ -e package-lock.json ]; then
      printf 'leftover=%s\\n' "\$count" >>"\$VF_FAKE_NPM_DIR/log"
    fi
    if [ -f "\$VF_FAKE_NPM_DIR/fail-\$count" ]; then
      mkdir -p node_modules
      : >node_modules/.partial-attempt
      : >package-lock.json
      while IFS= read -r line; do vf_say_error "\$line"; done <"\$VF_FAKE_NPM_DIR/fail-\$count"
      exit 1
    fi
    mkdir -p node_modules/jose
    exit 0
    ;;
esac
exit 0
`;

interface ScriptedInstallResult {
  code: number;
  stderr: string;
  installArgs: string[];
  leftovers: string[];
}

/**
 * Run the registry install smoke with `failures[i]` as the npm output of
 * install attempt i + 1. `node` always fails, so an install that eventually
 * succeeds surfaces as the behavior classification (21) rather than 20.
 */
async function runScriptedRegistryInstall(
  failures: string[][],
  maxAttempts: number,
): Promise<ScriptedInstallResult> {
  const tempDir = await makeTempDir({ prefix: "vf-registry-skew-" });
  const binDir = `${tempDir}/bin`;
  const npmDir = `${tempDir}/npm`;
  await Deno.mkdir(binDir);
  await Deno.mkdir(npmDir);
  await writeExecutable(`${binDir}/npm`, SCRIPTED_INSTALL_NPM);
  await writeExecutable(`${binDir}/node`, "#!/bin/bash\nexit 1\n");
  for (const [index, lines] of failures.entries()) {
    await Deno.writeTextFile(
      `${npmDir}/fail-${index + 1}`,
      lines.join("\n") + "\n",
    );
  }

  try {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", installSmokePath],
      env: {
        PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
        VF_FAKE_NPM_DIR: npmDir,
        VF_NPM_REGISTRY_INSTALL_ATTEMPTS: String(maxAttempts),
        VF_NPM_REGISTRY_RETRY_DELAY_MS: "0",
        VF_NPM_REGISTRY_PACKAGES: "veryfront\n@veryfront/ext-blob-gcs\n@veryfront/ext-auth-jwt",
        VF_NPM_REGISTRY_URL: "https://registry.npmjs.org/",
        VF_NPM_REGISTRY_VERSION: SKEW_VERSION,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const log = await Deno.readTextFile(`${npmDir}/log`).catch(() => "");
    const lines = log.trim().split("\n").filter(Boolean);
    return {
      code: output.code,
      stderr: decoder.decode(output.stderr),
      installArgs: lines.filter((line) => line.startsWith("args="))
        .map((line) => line.slice("args=".length)),
      leftovers: lines.filter((line) => line.startsWith("leftover=")),
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

/** The stale-packument signature npm printed in CI run 35445818678. */
const STALE_PACKUMENT_ERESOLVE = [
  "npm error code ERESOLVE",
  "npm error ERESOLVE unable to resolve dependency tree",
  "npm error While resolving: veryfront-npm-smoke-abc@1.0.0",
  "npm error Found: veryfront@undefined",
  `npm error   veryfront@"${SKEW_VERSION}" from the root project`,
  "npm error Could not resolve dependency:",
  `npm error peer veryfront@"^${SKEW_VERSION}" from @veryfront/ext-blob-gcs@${SKEW_VERSION}`,
];

const MISSING_VERSION_ETARGET = [
  "npm error code ETARGET",
  `npm error notarget No matching version found for @veryfront/ext-blob-gcs@${SKEW_VERSION}.`,
];

describe("exact-version registry install propagation retry", () => {
  it("retries a stale-packument install and continues once npm sees the version", async () => {
    const result = await runScriptedRegistryInstall(
      [STALE_PACKUMENT_ERESOLVE, MISSING_VERSION_ETARGET],
      5,
    );

    // Root install: two skewed attempts, then success; the behavior phase
    // (stubbed node) then fails, proving the install itself passed.
    assertEquals(result.code, 21, result.stderr);
    assertEquals(result.installArgs.length, 3);
    assertStringIncludes(
      result.stderr,
      "attempt 1/5 hit npm registry propagation skew (ERESOLVE: veryfront@undefined)",
    );
    assertStringIncludes(
      result.stderr,
      `attempt 2/5 hit npm registry propagation skew (ETARGET: @veryfront/ext-blob-gcs@${SKEW_VERSION})`,
    );
    // Each retry starts from a clean project and revalidates cached metadata.
    assertEquals(result.leftovers, []);
    for (const args of result.installArgs) {
      assertStringIncludes(args, "--prefer-online");
    }
  });

  it("fails immediately on an install error that is not propagation skew", async () => {
    for (
      const failure of [
        [
          "npm error code E401",
          "npm error 401 Unauthorized - GET https://registry.npmjs.org/veryfront",
        ],
        [
          "npm error code ERESOLVE",
          "npm error Found: react@18.3.1",
          `npm error peer react@"^19.0.0" from veryfront@${SKEW_VERSION}`,
        ],
        [
          "npm error code ETARGET",
          "npm error notarget No matching version found for left-pad@9.9.9.",
        ],
        [
          "npm error code ETARGET",
          "npm error notarget No matching version found for veryfront@1.2.3-rc.4.",
        ],
        [
          "npm error code E404",
          "npm error 404 Not Found - GET https://registry.npmjs.org/veryfront-typo",
        ],
      ]
    ) {
      const result = await runScriptedRegistryInstall([failure, failure], 5);

      assertEquals(result.code, 20, result.stderr);
      assertEquals(result.installArgs.length, 1, failure.join("\n"));
      assertEquals(result.stderr.includes("propagation skew"), false);
      assertStringIncludes(result.stderr, failure.join("\n"));
    }
  });

  it("gives up after the bounded attempts and keeps the sanitized diagnostics", async () => {
    const missingTarball = [
      "npm error code E404",
      `npm error 404 Not Found - GET https://registry.npmjs.org/veryfront/-/veryfront-${SKEW_VERSION}.tgz`,
      `npm error 404  'veryfront@${SKEW_VERSION}' is not in this registry.`,
      "npm error need auth //registry.npmjs.org/:_authToken=giveup-token-must-not-appear",
    ];
    const result = await runScriptedRegistryInstall(
      [missingTarball, missingTarball, missingTarball, missingTarball],
      3,
    );

    assertEquals(result.code, 20, result.stderr);
    assertEquals(result.installArgs.length, 3);
    assertStringIncludes(
      result.stderr,
      "attempt 2/3 hit npm registry propagation skew (E404: veryfront@",
    );
    assertEquals(result.stderr.includes("attempt 3/3 hit"), false);
    assertStringIncludes(
      result.stderr,
      "[registry=https://registry.npmjs.org/ specs=2 attempts=3]",
    );
    assertStringIncludes(
      result.stderr,
      `'veryfront@${SKEW_VERSION}' is not in this registry.`,
    );
    assertEquals(result.stderr.includes("giveup-token-must-not-appear"), false);
    assertStringIncludes(result.stderr, "_authToken=<redacted>");
    assertStringIncludes(
      result.stderr,
      "SMOKE FAIL: exact-version registry install failed",
    );
  });
});
