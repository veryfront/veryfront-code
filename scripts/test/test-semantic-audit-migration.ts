import type {
  SemanticDispositionEntry,
  SemanticEffect,
} from "./test-semantic-audit.ts";

type EntryMetadata = SemanticDispositionEntry extends infer Entry
  ? Entry extends SemanticDispositionEntry ? Omit<Entry, "path" | "effects">
  : never
  : never;

interface UnresolvedReadRelocation {
  readonly disposition: "unresolved-read-relocation";
  readonly owner: string;
  readonly removalPr: string;
}

export const TEST_SEMANTIC_AUDIT_MIGRATION_ENTRIES:
  readonly SemanticDispositionEntry[] = Object.freeze([
    entry("cli/app/operations/project-creation.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/app/operations/project-creation.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/auth/auth.integration.test.ts",
      ["filesystem-write", "network"],
      {
        "disposition": "integration-relocation",
        "owner": "cli",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/cli/auth/auth.integration.test.ts",
        "removalPr": "PR 4a",
      },
    ),
    entry("cli/auth/exit-code.integration.test.ts", [
      "filesystem-write",
      "process",
      "server",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/auth/exit-code.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/auth/login.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/auth/login.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/auth/token-store.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/auth/token-store.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/analyze-chunks/command.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/analyze-chunks/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/build/build-error.integration.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/build/build-error.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/build/embedded-preset-flags.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/build/embedded-preset-flags.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/build/error-handler.test.ts", ["shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/clean/clean.integration.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/clean/clean.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/clean/framework-cache.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/clean/framework-cache.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/config/handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/config/handler.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/demo/demo.integration.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/demo/demo.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/deploy/command.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/deploy/command.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/deploy/command.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/dev/dev-cache-guard.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "server",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/dev/dev-cache-guard.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/dev/dev-output.integration.test.ts", [
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/dev/dev-output.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/dev/dev.integration.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/dev/dev.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/dev/dev.test.ts", ["server", "network"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/dev/dev.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/dev/port-fallback.test.ts", [
      "filesystem-read",
      "server",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/dev/port-fallback.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/doctor/ai-checks.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/doctor/ai-checks.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/doctor/doctor.integration.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/doctor/doctor.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/commands/doctor/project-structure.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "cli",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/cli/commands/doctor/project-structure.test.ts",
        "removalPr": "PR 4a",
      },
    ),
    entry("cli/commands/doctor/server-checks.test.ts", [
      "filesystem-write",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/doctor/server-checks.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/eval/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/eval/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/extension/validate-command.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/extension/validate-command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/files/command.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/files/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/generate/generate.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/generate/generate.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/generate/integration-generator.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/generate/integration-generator.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/init/catalog.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/init/config-generator.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/init/config-generator.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/init/deno-config-generator.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/init/deno-config-generator.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/init/init-command.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/init/init-command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/init/init-deploy.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/init/init-deploy.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/init/init.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "server",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/init/init.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/commands/init/interactive-wizard.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("cli", "PR 4a"),
    ),
    entry("cli/commands/install/detect.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/install/detect.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/install/install.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/install/install.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/install/install.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/install/install.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/install/uninstall.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/install/uninstall.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/install/uninstall.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/install/uninstall.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/knowledge/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/knowledge/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/lock/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/lock/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/commands/open/handler.test.ts",
      ["filesystem-write", "process"],
      {
        "disposition": "integration-relocation",
        "owner": "cli",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/cli/commands/open/handler.test.ts",
        "removalPr": "PR 4a",
      },
    ),
    entry("cli/commands/pull/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/pull/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/push/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/push/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/routes/routes.integration.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/routes/routes.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/schedule/handler.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/schedule/handler.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/commands/serve/proxy-extension-composition.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "cli",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4a",
      },
    ),
    entry("cli/commands/serve/proxy-runtime-schema-contracts.test.ts", [
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/serve/proxy-runtime-schema-contracts.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/serve/proxy-runtime.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/serve/split-mode.test.ts", ["server"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/serve/split-mode.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/skills/create.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/skills/create.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/skills/handler.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/skills/handler.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/skills/validate.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/skills/validate.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/start/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/start/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/up/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/up/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/up/up.integration.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/up/up.integration.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/uploads/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/uploads/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/webhook/handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/webhook/handler.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/commands/workflow/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/commands/workflow/command.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/encrypted-token-store-template.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/dev-server-client.test.ts", ["server"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/mcp/dev-server-client.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/remote-file-tools.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/server.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/mcp/server.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/tools/catalog-tools.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/mcp/tools/catalog-tools.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/tools/context7-tools.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/tools/deploy-tool.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/mcp/tools/deploy-tool.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/tools/dev-tools.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/tools/project-tools.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/mcp/tools/project-tools.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/mcp/tools/scaffold-tools.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/mcp/tools/scaffold-tools.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/node-engine-precondition.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("cli", "PR 4a"),
    ),
    entry("cli/router.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/router.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/scaffold/engine.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/scaffold/engine.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/config.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/config.test.ts",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/shared/constants.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("cli", "PR 4a"),
    ),
    entry("cli/shared/deployment-provenance.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/deployment-provenance.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/deployment/deploy-project.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/deployment/deploy-project.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/json-output.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/json-output.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/project-creation.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/project-creation.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/project-link.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/project-link.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/project-resolution.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/project-resolution.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/project-source-context.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/project-source-context.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/reserve-slug.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4a",
    }),
    entry("cli/shared/runtime-auth.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/shared/runtime-auth.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/skills/loader.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/skills/loader.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/sync/ignore.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/sync/ignore.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/sync/project-discovery.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/sync/project-discovery.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/sync/state.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/sync/state.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/token-store-template.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/ui/components/banner.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/ui/components/shortcuts.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/ui/components/table.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry("cli/utils/git.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/utils/git.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("cli/utils/index.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "cli",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4a",
    }),
    entry(
      "cli/utils/package-manager.test.ts",
      ["filesystem-write", "process"],
      {
        "disposition": "integration-relocation",
        "owner": "cli",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/cli/utils/package-manager.test.ts",
        "removalPr": "PR 4a",
      },
    ),
    entry("cli/utils/write-run-result.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "cli",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/cli/utils/write-run-result.test.ts",
      "removalPr": "PR 4a",
    }),
    entry("extensions/ext-blob-gcs/src/gcs-storage.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-blob-s3/src/s3-storage.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-bundler-esbuild/src/esbuild-bundler.test.ts", [
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/extensions/ext-bundler-esbuild/src/esbuild-bundler.test.ts",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-cache-redis/src/index.test.ts", [
      "filesystem-read",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-css-lightning/src/index.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-css-tailwind/src/index.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4e",
    }),
    entry(
      "extensions/ext-css-tailwind/src/plugin-loader.test.ts",
      ["network"],
      {
        "disposition": "replaceable-fake",
        "owner": "extensions-templates",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4e",
      },
    ),
    entry("extensions/ext-eval-report-mlflow/src/index.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-llm-anthropic/src/anthropic-native-content.test.ts", [
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/extensions/ext-llm-anthropic/src/anthropic-native-content.test.ts",
      "removalPr": "PR 4e",
    }),
    entry(
      "extensions/ext-llm-anthropic/src/anthropic-request-builder.test.ts",
      ["process"],
      {
        "disposition": "integration-relocation",
        "owner": "extensions-templates",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/extensions/ext-llm-anthropic/src/anthropic-request-builder.test.ts",
        "removalPr": "PR 4e",
      },
    ),
    entry("extensions/ext-llm-google/src/google-request-builder.test.ts", [
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/extensions/ext-llm-google/src/google-request-builder.test.ts",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-llm-openai/src/openai-web-search.test.ts", [
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/extensions/ext-llm-openai/src/openai-web-search.test.ts",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-node-websocket-ws/src/package-boundary.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("extensions-templates", "PR 4e")),
    entry("extensions/ext-observability-opentelemetry/src/index.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-observability-sentry/src/node.test.ts", [
      "filesystem-read",
    ], {
      "disposition": "hermetic-unit",
      "owner": "extensions-templates",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("extensions/ext-parser-babel/src/index.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-parser-babel/src/parser-only.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/extensions/ext-parser-babel/src/parser-only.test.ts",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-redis/src/rate-limit-store.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4e",
    }),
    entry("extensions/ext-yaml/src/adapter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("react/react.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "react",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("scripts/build/browser-safe-exports.test.ts", [
      "filesystem-read",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/browser-safe-exports.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/compile-binary.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/compile-binary.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/dnt-jsx-runtime.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/dnt-jsx-runtime.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/dnt-meta-property-safety.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/dnt-meta-property-safety.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/dnt-polyfill.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/dnt-polyfill.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/generate-sbom.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/generate-sbom.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/generated-artifact-checks.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/generated-artifact-checks.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/npm-dependency-sources.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "scripts-tooling",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("scripts/build/npm-extension-package-metadata.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/npm-extension-package-metadata.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/npm-package-metadata.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/npm-package-metadata.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/npm-react-shims.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/npm-react-shims.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/npm-runtime-helper-contract.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/npm-runtime-helper-contract.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/build/prepare-framework-sources.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/prepare-framework-sources.test.ts",
      "removalPr": "PR 4f",
    }),
    entry(
      "scripts/build/report-artifact-sizes.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("scripts-tooling", "PR 4f"),
    ),
    entry(
      "scripts/build/runtime-support.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("scripts-tooling", "PR 4f"),
    ),
    entry("scripts/build/sentry-runtime-packages.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/build/sentry-runtime-packages.test.ts",
      "removalPr": "PR 4f",
    }),
    entry(
      "scripts/ci/automated-review-gate.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("scripts-tooling", "PR 4f"),
    ),
    entry("scripts/ci/prepare-rc-build.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/ci/prepare-rc-build.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/ci/publish-npm-packages.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/ci/publish-npm-packages.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/ci/setup-deno-workflow.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/ci/setup-deno-workflow.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/ci/windows-localhost.test.ts", [
      "filesystem-read",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/ci/windows-localhost.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/docs/generate-api-reference.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/docs/generate-api-reference.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/lint/audit-extension-capabilities.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/lint/audit-extension-capabilities.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/lint/audit-extension-contracts.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/lint/audit-extension-contracts.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/lint/extension-manifest-reader.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/lint/extension-manifest-reader.test.ts",
      "removalPr": "PR 4f",
    }),
    entry(
      "scripts/lint/lint-config.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("scripts-tooling", "PR 4f"),
    ),
    entry("scripts/postinstall-lib.test.js", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/postinstall-lib.test.js",
      "removalPr": "PR 4f",
    }),
    entry("scripts/release.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "scripts-tooling",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("scripts/security/audit-npm.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "scripts-tooling",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("scripts/security/secret-scanning-config.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("scripts-tooling", "PR 4f")),
    entry(
      "scripts/storybook/storybook-workbench.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("scripts-tooling", "PR 4f"),
    ),
    entry("scripts/test/coverage-ci.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/test/coverage-ci.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/test/run-suite.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/test/run-suite.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/test/runtime-inference-critical-flow.test.ts", [
      "filesystem-read",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/test/runtime-inference-critical-flow.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/test/template-runtime-e2e.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/test/template-runtime-e2e.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/test/test-layout.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/test/test-layout.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("scripts/test/test-semantic-audit.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "scripts-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/scripts/test/test-semantic-audit.test.ts",
      "removalPr": "PR 4f",
    }),
    entry("src/agent/child-run/invoke-agent-child-runs.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/composition/composition.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/bootstrap.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/durable.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/hosted-lifecycle.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/hosted-terminal.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/root-run-context.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/root-run-lifecycle.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/conversation/run-chunk-mirror.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/factory-call-context.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/agent-project-steering.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/hosted/agent-project-steering.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/chat-execution-runtime.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/hosted/chat-execution-runtime.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/chat-preparation.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/chat-runtime-tool-assembly.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/child-bootstrap.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/child-fork-run-context.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry(
      "src/agent/hosted/child-run-event-writer-token.test.ts",
      ["process", "network"],
      {
        "disposition": "replaceable-fake",
        "owner": "agent-runtime",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4g",
      },
    ),
    entry("src/agent/hosted/child-status.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/cloud-agent-paths.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/hosted/cloud-agent-paths.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/cloud-chat-execution-preparation.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/cloud-prepared-chat-execution-runtime.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/default-chat-runtime.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/default-invoke-agent-tool.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry(
      "src/agent/hosted/durable-child-fork-execution.test.ts",
      ["network"],
      {
        "disposition": "replaceable-fake",
        "owner": "agent-runtime",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4g",
      },
    ),
    entry("src/agent/hosted/form-input-tool.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/hosted-chat-finalization.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/lifecycle.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/project-reference-resolver.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates Object.prototype and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Build the inherited-value fixture with a test-owned prototype chain instead of mutating Object.prototype.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/project-remote-tool-source.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("agent-runtime", "PR 4g")),
    entry("src/agent/hosted/project-steering-adapter.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/hosted/project-steering-adapter.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/hosted/veryfront-cloud-agent-service.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/hosted/veryfront-cloud-agent-service.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/input/request-protocol.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/middleware/rate-limit/limiter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/project/agent-runtime.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/project/agent-runtime.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/project/context.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/react/use-chat/use-chat.csrf.test.tsx", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/react/use-chat/use-chat.status.test.tsx", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/agent-definition-files.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/runtime/agent-definition-files.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/agent-span-error-redaction.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry(
      "src/agent/runtime/builtin-skill-files.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "agent-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/agent/runtime/builtin-skill-files.test.ts",
        "removalPr": "PR 4g",
      },
    ),
    entry("src/agent/runtime/error-utils.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/runtime/error-utils.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/load-skill-tool.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/mcp-server-tool-sources.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/message-preparation.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/model-resolution.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/project-skill-catalog.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/runtime/project-skill-catalog.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/project-skill-loader.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/provider-metadata-continuation.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/provider-transport.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/refresh.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/runtime-message-origin.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/skill-metadata.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/skill-prompt.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/tool-exposure.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/runtime/tool-helpers.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/service/env-files.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/agent/service/env-files.test.ts",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/streaming/data-stream.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/agent/streaming/fork-runtime-stream.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/build/asset-pipeline/css-optimizer.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/css-optimizer.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/css-optimizer/cache-manager.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/css-optimizer/cache-manager.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/css-optimizer/critical-css.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/css-optimizer/critical-css.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/css-optimizer/node18-compat.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/build/asset-pipeline/css-optimizer/optimization-engine.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "build-rendering",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/build/asset-pipeline/css-optimizer/optimizer-service.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/css-optimizer/optimizer-service.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/css-optimizer/strategies.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/css-optimizer/strategies.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/css-optimizer/utils.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/css-optimizer/utils.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/image-optimizer/image-finder.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/image-optimizer/image-finder.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/image-optimizer/manifest-manager.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/image-optimizer/manifest-manager.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/image-optimizer/optimizer-core.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/image-optimizer/optimizer-core.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/asset-pipeline/output-planning.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/output-planning.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/build/asset-pipeline/tailwind-processor/batch-processor.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/tailwind-processor/batch-processor.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/build/asset-pipeline/tailwind-processor/processor.test.ts", [
      "filesystem-read",
      "filesystem-watch",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/asset-pipeline/tailwind-processor/processor.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/bundler/code-splitter/build-context.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/bundler/code-splitter/build-context.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/bundler/code-splitter/esbuild-plugin.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/bundler/code-splitter/esbuild-plugin.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/bundler/code-splitter/splitter.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/bundler/code-splitter/splitter.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/compiler/mdx-compiler/compiler.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/compiler/mdx-compiler/compiler.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/compiler/mdx-compiler/file-writer.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/compiler/mdx-compiler/file-writer.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/compiler/mdx-compiler/validator.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/compiler/mdx-compiler/validator.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/build/embedded/preset.test.ts",
      ["filesystem-write", "process"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/build/embedded/preset.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/build/production-build/build/build-executor.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/production-build/build/build-executor.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/production-build/build/build-orchestrator.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/production-build/build/build-orchestrator.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/production-build/build/build-publication.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/production-build/build/build-publication.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/production-build/build/build-setup.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/production-build/build/build-setup.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/production-build/local-release-assets.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/build/production-build/local-release-assets.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/build/production-build/static-generation.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/cache/backend.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/backends/disk.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/cache/backends/disk.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/backends/disk-pruning.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/cache/backends/disk-pruning.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/backends/factory.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/backends/local-dev-disk-cache.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/cache/backends/local-dev-disk-cache.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/bounded-read.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/config-hash.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/keys.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/cache/verified-api-credential-context.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/chat/ag-ui.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "core-runtime",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry(
      "src/chat/client-import-boundary.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry("src/chat/upload-handler.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/chat/upload-handler.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/client/spa/ClientApp.reactivity.test.tsx", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/client/spa/ClientApp.test.tsx", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/client/spa/component-loader.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/client/spa/path-utils.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/config/cicd-coverage-workflow.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("config-tooling", "PR 4i"),
    ),
    entry("src/config/cicd-stable-release.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/config/cicd-stable-release.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/config/declarative-evaluator.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/config/declarative-evaluator.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/config/env.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/config/environment-config.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/config/loader.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/config/loader.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/config/schemas/config.schema.test.ts", ["shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/config/snapshot.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry(
      "src/config/tsconfig-paths-parity.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("config-tooling", "PR 4i"),
    ),
    entry("src/data/server-data-fetcher.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "data-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/data/server-data-fetcher.test.ts",
      "removalPr": "PR 4j",
    }),
    entry("src/discovery/agent-scoped-capabilities.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/discovery/agent-scoped-capabilities.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/discovery/auto-discovery.integration.test.ts", [
      "filesystem-write",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/discovery/auto-discovery.integration.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/discovery/file-discovery.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/discovery/file-discovery.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/discovery/import-rewriter.test.ts", [
      "filesystem-write",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/discovery/import-rewriter.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/discovery/transpiler.test.ts", ["process", "shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/embedding/embedding.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/embedding/model-resolution.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/embedding/rag-store.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "data-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/embedding/rag-store.test.ts",
      "removalPr": "PR 4j",
    }),
    entry("src/embedding/upload-handler.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/errors/error-handlers.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/errors/http-error.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/errors/logging.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/errors/middleware/cli-error-boundary.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/errors/tenant-classification.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/errors/types.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/errors/veryfront-error.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/eval/agent-service.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/eval/agent-service.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/eval/datasets.test.ts", ["filesystem-write", "shared-cwd"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/eval/datasets.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/eval/factory.test.ts", ["shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/eval/report.test.ts", ["shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/abort-signal.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/auth/rsc-action-authorization-provider.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/browser/immutable-browser-bundle.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry(
      "src/extensions/builtin-extensions.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry("src/extensions/contract-registry-internal.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Mutates Object.prototype and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Build inherited contract-registry fixtures with a test-owned prototype chain instead of mutating Object.prototype.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/css/css-optimization-engine.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/css/css-processor.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/discovery.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/discovery.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/entrypoint-identity.runtime.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/entrypoint-identity.runtime.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/entrypoint-identity.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/entrypoint-identity.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/factory-loader.test.ts", [
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/factory-loader.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/install-command.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/install-command.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/manifest-reader.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/manifest-reader.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/orchestrate.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/orchestrate.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/extensions/parser/skill-document-parser.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/parser/yaml-parser.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4e",
    }),
    entry("src/extensions/promise-intrinsics-internal.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Mutates Promise and Promise.prototype and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Exercise poisoned Promise hooks through an injected intrinsic table or an isolated runtime instead of mutating the host Promise intrinsic.",
      "removalPr": "PR 4e",
    }),
    entry(
      "src/extensions/rendering/isolated-ssr-renderer.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "extensions-templates",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
        "removalPr": "PR 4e",
      },
    ),
    entry("src/extensions/setup-hint.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/extensions/setup-hint.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/html/html-shell-generator.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4h",
    }),
    entry("src/html/html-shell-manifest.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/html/hydration-script-builder/runtime/navigation-store.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "build-rendering",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/html/nonce-injection.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4h",
    }),
    entry("src/html/styles-builder/css-pregeneration.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/html/styles-builder/css-pregeneration.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/html/styles-builder/project-css-cache.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4h",
    }),
    entry("src/html/styles-builder/tailwind-compiler-regression.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4h",
    }),
    entry("src/html/styles-builder/tailwind-default-processor.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4h",
    }),
    entry("src/html/utils.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/html/utils.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/index.client.boundary.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry(
      "src/integrations/_data.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("data-runtime", "PR 4j"),
    ),
    entry("src/integrations/feature-flags.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/integrations/index.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/integrations/local-credential-host-policy.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject the host-environment reader instead of mutating process-global environment state through withEnv.",
      "removalPr": "PR 4j",
    }),
    entry("src/integrations/local-tool-source.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Mutates Object.prototype across an asynchronous credential flow and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject the body-serialization boundary so post-auth drift is exercised without poisoning Object.prototype.",
      "removalPr": "PR 4j",
    }),
    entry("src/integrations/remote-tools.hardening.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/integrations/remote-tools.test.ts", [
      "filesystem-read",
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/integrations/salesforce-service-account.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "data-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4j",
    }),
    entry("src/internal-agents/control-plane-auth.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/internal-agents/run-stream.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/issues/core.test.ts", ["filesystem-read", "filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/issues/core.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/knowledge/index.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "data-runtime",
      "rationale":
        "Exercises temporary or mutable filesystem state and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/knowledge/index.test.ts",
      "removalPr": "PR 4j",
    }),
    entry("src/mcp/server.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4n",
    }),
    entry("src/mdx/provider.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/metrics/index.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/middleware/builtin/security/rate-limit.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/middleware/builtin/security/redis-rate-limit.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/middleware/core/pipeline/pipeline.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/middleware/core/pipeline/pipeline.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/modules/import-map/loader.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises a real browser or Node worker runtime and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/import-map/loader.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/import-map/merger.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/import-map/preloader.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises a real browser or Node worker runtime and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/import-map/preloader.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/react-loader/ssr-module-loader.stress.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader.stress.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/modules/react-loader/ssr-module-loader/cache/dev-disk-persistence.test.ts",
      ["filesystem-read", "filesystem-write", "process"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader/cache/dev-disk-persistence.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/modules/react-loader/ssr-module-loader/cache/memory.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/react-loader/ssr-module-loader/loader.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "network",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises temporary or mutable filesystem state and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader/loader.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/modules/react-loader/ssr-module-loader/http-bundle-helpers.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader/http-bundle-helpers.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry(
      "src/modules/react-loader/ssr-module-loader/ssr-cache-manager.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader/ssr-cache-manager.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry(
      "src/modules/react-loader/ssr-module-loader/ssr-dependency-validator.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader/ssr-dependency-validator.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry(
      "src/modules/react-loader/ssr-module-loader/vf-module-resolver.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/modules/react-loader/ssr-module-loader/vf-module-resolver.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/modules/react-loader/transformed-module-coordinator.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/react-loader/transformed-module-coordinator.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/README.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "build-rendering",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("src/modules/server/module-batch-handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/server/module-batch-handler.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/server/module-server.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/server/module-server.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/server/module-server.traversal.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/server/module-server.traversal.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/server/module-source-bounds.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/modules/server/module-source-bounds.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/server/module-transform.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/modules/server/ssr-import-rewriter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4h",
    }),
    entry("src/oauth/handlers/callback-dispatcher.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4n",
    }),
    entry("src/oauth/handlers/callback-handler.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/oauth/providers/atlassian.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry("src/oauth/providers/base.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/oauth/providers/common.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry(
      "src/oauth/providers/google.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry(
      "src/oauth/providers/microsoft.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry("src/oauth/providers/protocols.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4n",
    }),
    entry("src/oauth/token-store/memory.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/observability/application-errors.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/observability/file-log-subscriber.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/observability/file-log-subscriber.test.ts",
      "removalPr": "PR 4i",
    }),
    entry(
      "src/observability/production-log-noise.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("config-tooling", "PR 4i"),
    ),
    entry("src/observability/request-profiler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/observability/sentry.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/observability/telemetry-error.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/observability/tracing/otlp-setup.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/observability/tracing/service-tracer.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/observability/tracing/telemetry-env.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/platform/adapters/adapter-readme-guidance.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("runtime-platform", "PR 4b")),
    entry("src/platform/adapters/bounded-file-read.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/bounded-text-reader.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/adapters/file-system-capabilities.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "runtime-platform",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
        "removalPr": "PR 4b",
      },
    ),
    entry("src/platform/adapters/fs/github/adapter.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/github/github-api-client.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/integration.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises the filesystem adapter through the shared fetch transport and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/fs/integration.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/veryfront/adapter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/veryfront/content-log-safety.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/veryfront/invalidation-state.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/veryfront/platform-boundary.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("runtime-platform", "PR 4b")),
    entry("src/platform/adapters/fs/veryfront/proxy-manager.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/veryfront/stat-operations.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/fs/veryfront/websocket-manager.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/native-file-system-provenance.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/runtime/bun/filesystem-adapter.bun.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/bun/filesystem-adapter.bun.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/runtime/bun/filesystem-adapter.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/bun/filesystem-adapter.test.ts",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/adapters/runtime/bun/http-server.test.ts",
      ["network"],
      {
        "disposition": "integration-relocation",
        "owner": "runtime-platform",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/bun/http-server.test.ts",
        "removalPr": "PR 4b",
      },
    ),
    entry("src/platform/adapters/runtime/deno/adapter.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/deno/adapter.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/runtime/deno/filesystem-adapter.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/deno/filesystem-adapter.test.ts",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/adapters/runtime/deno/http-server.test.ts",
      ["network"],
      {
        "disposition": "integration-relocation",
        "owner": "runtime-platform",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/deno/http-server.test.ts",
        "removalPr": "PR 4b",
      },
    ),
    entry("src/platform/adapters/runtime/node/adapter.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/node/adapter.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/runtime/node/filesystem-adapter.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/node/filesystem-adapter.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/runtime/node/http-server.test.ts", [
      "server",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/node/http-server.test.ts",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/adapters/runtime/shared/node-filesystem-adapter.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "runtime-platform",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/shared/node-filesystem-adapter.test.ts",
        "removalPr": "PR 4b",
      },
    ),
    entry("src/platform/adapters/runtime/shared/shared-watcher.test.ts", [
      "filesystem-read",
    ], {
      "disposition": "hermetic-unit",
      "owner": "runtime-platform",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("src/platform/adapters/runtime/shared/temp-dir.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/adapters/runtime/shared/temp-dir.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/token/integration.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/adapters/token/veryfront/adapter.test.ts",
      ["network"],
      {
        "disposition": "replaceable-fake",
        "owner": "runtime-platform",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4b",
      },
    ),
    entry("src/platform/adapters/token/veryfront/api-client.test.ts", [
      "filesystem-read",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/veryfront-api-client.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/veryfront-api-client/operations.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/adapters/veryfront-api-client/retry-handler.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/adapters/veryfront-api-transport.test.ts",
      ["network"],
      {
        "disposition": "replaceable-fake",
        "owner": "runtime-platform",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4b",
      },
    ),
    entry("src/platform/cloud/resolver.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/cross-runtime-simple.test.ts", [
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/cross-runtime-simple.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/cross-runtime.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/cross-runtime.test.ts",
      "removalPr": "PR 4b",
    }),
    entry(
      "src/platform/compat/dynamic-import.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("runtime-platform", "PR 4b"),
    ),
    entry("src/platform/compat/error-introspection.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/fs-remove-portable.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises temporary or mutable filesystem state and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/fs-remove-portable.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/fs.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises temporary or mutable filesystem state and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/fs.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/http/deno-server.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/http/deno-server.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/http/node-server.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/http/node-server.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/http/pinned-fetch.test.ts", [
      "server",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/http/pinned-fetch.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/kv/memory-adapter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/kv/sqlite-adapter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/native-brand-checks.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/opaque-deps.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/path/portable.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/path/resolution.test.ts", ["shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on shared working-directory state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a scoped cwd/path-resolution boundary instead of reading or mutating process-wide cwd.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/primordials/array.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/process.test.ts", [
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/process.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/process/command.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/process/command.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/process/env.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises subprocess isolation and host permission behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/process/env.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/proxy-topology.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/shims/deno-env.test.ts", [
      "filesystem-read",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/shims/std-fs.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/shims/std-fs.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/std/async.test.ts", [
      "filesystem-read",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/std/dotenv.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/std/dotenv.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/compat/std/fs.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "runtime-platform",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/platform/compat/std/fs.test.ts",
      "removalPr": "PR 4b",
    }),
    entry("src/platform/environment.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "runtime-platform",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4b",
    }),
    entry("src/provider/local/env.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/local/local-engine-stop.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/local/local-provider.test.ts", [
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "provider-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/provider/local/local-provider.test.ts",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/model-registry.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/runtime-loader-helpers.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "provider-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/provider/runtime-loader-helpers.test.ts",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/runtime-loader/provider-sse.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/runtime-loader/provider-usage-merge.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/veryfront-cloud/provider.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4l",
    }),
    entry("src/provider/veryfront-cloud/shared.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "provider-runtime",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4l",
    }),
    entry("src/proxy/cache/index.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry(
      "src/proxy/control-plane-signature.api-contract.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "server-routes",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4c",
      },
    ),
    entry("src/proxy/control-plane-signature.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/handler.test.ts", ["process", "shared-cwd"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/main.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "server-routes",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("src/proxy/mode-parity.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/oauth-client.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on the process-global fetch and outbound-transport boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch or transport dependency owned by the test instead of replacing the shared runtime fetch and resolver.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/proxy-access-control.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/server-resolver.test.ts", ["server"], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/proxy/server-resolver.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/server-timing.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/shutdown-lifecycle.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/token-manager.test.ts", ["server"], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/proxy/token-manager.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/tracing.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/proxy/websocket-client.test.ts", ["process", "server"], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/proxy/websocket-client.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/react/compat/hooks-adapter.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/compat/version-detector/feature-detector.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/react/compat/version-detector/feature-detector.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/react/compat/version-detector/version-detector.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/react/compat/version-detector/version-detector.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/agent-picker.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/chat-agent-picker.test.tsx", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/chat-markdown.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/app-mode-chat.test.tsx",
      ["process", "network"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/chat/chat/chat.controlled.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/components/message-actions.test.tsx",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/chat/chat/components/sidebar.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/chat/components/tool-ui.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/composition/chat-composer.shared-context.test.tsx",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/chat/chat/composition/chat-composer.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/chat/composition/chat-empty.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/chat/composition/message.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/contexts/conversations-context.test.tsx",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/chat/chat/hooks/attachment-csrf.test.tsx", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/hooks/use-conversation-chat.test.tsx",
      ["process", "network"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/chat/chat/hooks/use-conversation.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/hooks/use-conversations.hook.test.tsx",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/chat/chat/hooks/use-drop-zone.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/chat/hooks/use-upload.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/chat/chat/hooks/use-uploads-registry.test.tsx",
      ["process", "network"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/react/components/chat/chat/persistence/conversation-codec.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/react/components/chat/coverage.test.tsx",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry("src/react/components/chat/hooks-coverage.test.tsx", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/chat/missing-renderer-warning.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("core-runtime", "PR 4n")),
    entry("src/react/components/optimized-image/helpers.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/accordion.behaviour.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/combobox.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/dialog.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/disclosure.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/popover.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/tabs.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/toast.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/toggle-group.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/adapter/toolbar.conformance.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/autocomplete.behaviour.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/ui/boundary.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry("src/react/components/ui/code-block.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/color-mode.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/context-menu.behaviour.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/react/components/ui/coverage.test.tsx",
      ["filesystem-read"],
      unresolvedReadRelocation("core-runtime", "PR 4n"),
    ),
    entry(
      "src/react/components/ui/hover-card.behaviour.test.tsx",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/react/components/ui/list.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/components/ui/number-field.behaviour.test.tsx", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/primitives/input-box.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/runtime/head-client.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/react/runtime/router-provider.test.tsx", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/registry/project-scoped-registry-manager.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/release-assets/build-executor.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/release-assets/build-executor.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/release-assets/dependency-artifact-mode.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/release-assets/html-consumption.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/release-assets/manifest-cache.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/release-assets/module-consumption.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/release-assets/scaffolded-project-build.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/release-assets/scaffolded-project-build.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/cache/cache-coordinator.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/cache/stores/api-store.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/cache/stores/redis-store.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/client/browser-logger.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/client/prefetch/link-observer.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/client/prefetch/network-utils.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/client/prefetch/resource-hints.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/client/router.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/client/state-bridge.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/orchestrator/html.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/orchestrator/module-loader/cycle-manifest.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/orchestrator/module-loader/cycle-manifest.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/rendering/orchestrator/module-loader/dependency-resolver.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/rendering/orchestrator/module-loader/dependency-resolver.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/rendering/orchestrator/module-loader/esm-rewriter.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/orchestrator/module-loader/index.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/orchestrator/module-loader/index.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/rendering/orchestrator/module-loader/module-cache-lookup.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/rendering/orchestrator/module-loader/module-cache-lookup.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry(
      "src/rendering/orchestrator/module-loader/module-persistence.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "build-rendering",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/rendering/orchestrator/module-loader/module-persistence.test.ts",
        "removalPr": "PR 4h",
      },
    ),
    entry(
      "src/rendering/orchestrator/module-loader/module-transform-cache.test.ts",
      ["filesystem-write", "process"],
      {
        "disposition": "replaceable-fake",
        "owner": "build-rendering",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/rendering/orchestrator/pipeline.behavior.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/renderer-concurrency.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/renderer.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/renderer.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/router-detection.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/router-detection.test.ts",
      "removalPr": "PR 4h",
    }),
    entry(
      "src/rendering/rsc/dependency-snapshot-recovery.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "build-rendering",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
        "removalPr": "PR 4h",
      },
    ),
    entry("src/rendering/rsc/server-renderer/component-detector.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("build-rendering", "PR 4h")),
    entry("src/rendering/script-page-handling.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/script-page-handling.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/shared/context-aware-cache.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/snippet-renderer.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/snippet-renderer.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/ssr-globals/dom-stubs.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "build-rendering",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4h",
    }),
    entry("src/rendering/ssr-renderer.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "build-rendering",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/rendering/ssr-renderer.test.ts",
      "removalPr": "PR 4h",
    }),
    entry("src/routing/api/handler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/api/module-loader/esbuild-plugin.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/routing/api/module-loader/esbuild-plugin.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/api/module-loader/loader.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/routing/api/module-loader/loader.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/api/openapi/mcp-tools.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises API routing and remote MCP transport behavior across components and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/routing/api/openapi/mcp-tools.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/api/route-executor.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/client/dom-utils.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/client/navigation-handlers.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/client/page-loader.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/client/page-transition.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/client/viewport-prefetch.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/registry/registry.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/routing/router.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/runs/runs-client.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4g",
    }),
    entry("src/sandbox/agent-service-tools.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4n",
    }),
    entry("src/sandbox/sandbox.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/schemas/primitives.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/security/host-execution-policy.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/http/auth.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/http/base-handler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/http/config.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/http/config.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/http/cors/validators.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/http/cors/validators.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/http/csrf/csrf-handler.test.ts", ["filesystem-read"], {
      "disposition": "hermetic-unit",
      "owner": "security-filesystem",
      "rationale":
        "Reads checked-in repository fixtures or contract files without mutating process, network, or external runtime state.",
    }),
    entry("src/security/http/outbound-fetch.test.ts", ["network", "process"], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/http/outbound-fetch.test.ts",
      "removalPr": "PR 4d",
    }),
    entry(
      "src/security/index.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("security-filesystem", "PR 4d"),
    ),
    entry("src/security/path-validation/canonical.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/path-validation/canonical.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/path-validation/index.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/path-validation/index.test.ts",
      "removalPr": "PR 4d",
    }),
    entry(
      "src/security/repository-hardening.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("security-filesystem", "PR 4d"),
    ),
    entry("src/security/sandbox/isolation-posture.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/project-worker.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "server",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/sandbox/project-worker.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/telemetry-redaction.test.ts", [
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/sandbox/telemetry-redaction.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/worker-byte-encoding.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/worker-egress-guard.test.ts", [
      "server",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/sandbox/worker-egress-guard.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/worker-error-boundary.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/worker-permissions.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "security-filesystem",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/worker-pool.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/sandbox/worker-pool.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/sandbox/worker-read-scope.test.ts", [
      "filesystem-write",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/sandbox/worker-read-scope.test.ts",
      "removalPr": "PR 4d",
    }),
    entry(
      "src/security/sandbox/worker-script-bootstrap.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("security-filesystem", "PR 4d"),
    ),
    entry("src/security/sandbox/worker-script.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/sandbox/worker-script.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/security/secure-fs.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "security-filesystem",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/security/secure-fs.test.ts",
      "removalPr": "PR 4d",
    }),
    entry("src/server/bootstrap.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/bootstrap.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/build-app-route-renderer.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/build-app-route-renderer.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/context/request-context.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/dev-server/cache-initialization.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("server-routes", "PR 4c")),
    entry("src/server/dev-server/handler-only.integration.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/dev-server/handler-only.integration.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/dev-server/middleware.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/dev-server/route-discovery.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/dev-server/server-start-failure.integration.test.ts", [
      "server",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/dev-server/server-start-failure.integration.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/dev/files/dev-file.handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/dev/files/dev-file.handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/dev/files/esbuild-plugins.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/dev/files/esbuild-plugins.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/dev/styles-css.handler.test.ts", ["network"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/execution-surface-policy.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("server-routes", "PR 4c")),
    entry("src/server/handlers/monitoring/client-log.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/preview/markdown-preview.handler.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/agent-stream.handler.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/api/project-discovery.test.ts", [
      "process",
      "shared-cwd",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/internal-agents-list.handler.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/lib-modules.handler.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/module/data-endpoint-handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/request/module/data-endpoint-handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/module/module-server-handler.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry(
      "src/server/handlers/request/module/page-data-endpoint-handler.test.ts",
      ["filesystem-write", "process"],
      {
        "disposition": "integration-relocation",
        "owner": "server-routes",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/server/handlers/request/module/page-data-endpoint-handler.test.ts",
        "removalPr": "PR 4c",
      },
    ),
    entry("src/server/handlers/request/module/page-module-handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/request/module/page-module-handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/project-run-execute.handler.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/ssr/error-page-fallback.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/request/ssr/error-page-fallback.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/ssr/not-found-fallback.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/request/ssr/not-found-fallback.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/ssr/ssr-response-builder.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/ssr/ssr-snapshot.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/request/ssr/ssr-snapshot.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/request/static.handler.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/request/static.handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/handlers/utils/dependency-snapshot-protocol.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/handlers/utils/dependency-snapshot-protocol.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/fetcher.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/framework-env-bypass.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/getenv-integration.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/hosted-authorization.test.ts", [
      "network",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/process-env-scope.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/production-environment-resolver.test.ts", [
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/reserved-env.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/snapshot.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/project-env/storage.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/runtime-handler/adapter-factory.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/runtime-handler/index.test.ts", [
      "filesystem-write",
      "process",
      "network",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/runtime-handler/index.test.ts",
      "removalPr": "PR 4c",
    }),
    entry(
      "src/server/runtime-handler/project-middleware.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "server-routes",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
        "removalPr": "PR 4c",
      },
    ),
    entry(
      "src/server/runtime-handler/project-resolution.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "server-routes",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4c",
      },
    ),
    entry("src/server/runtime-handler/project-runtime-context.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/runtime-handler/request-tracker.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry(
      "src/server/service-server.test.ts",
      ["process", "network"],
      {
        "disposition": "integration-relocation",
        "owner": "server-routes",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/server/service-server.test.ts",
        "removalPr": "PR 4c",
      },
    ),
    entry(
      "src/server/services/rsc/endpoints/action-authorization-snapshot.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "server-routes",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
        "removalPr": "PR 4c",
      },
    ),
    entry("src/server/services/rsc/endpoints/action-authorization.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/services/rsc/endpoints/action-handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/services/rsc/endpoints/action-handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/services/rsc/endpoints/action-parser.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/services/rsc/endpoints/endpoint-router.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/services/rsc/endpoints/endpoint-router.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/services/rsc/endpoints/handler-registry.test.ts", [
      "filesystem-read",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises temporary or mutable filesystem state and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/services/rsc/endpoints/handler-registry.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/services/rsc/orchestrators/handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/services/rsc/orchestrators/handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/services/rsc/orchestrators/render-handler.test.ts", [
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "server-routes",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/server/services/rsc/orchestrators/render-handler.test.ts",
      "removalPr": "PR 4c",
    }),
    entry("src/server/shared/browser-module-bundler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/server/utils/proxy-trust.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "server-routes",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4c",
    }),
    entry("src/skill/document-parser.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/executor.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/skill/executor.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/parser.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/path-safety.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/skill/path-safety.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/registry.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/selector.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/skill-owner-scope.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/skill/skill-owner-scope.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/string-safety.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/tools.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/skill/tools.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/skill/types.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/studio/bridge/bridge-config.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/studio/bridge/bridge-message-handler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/studio/bridge/bridge-messaging.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/testing/bdd-env-overlay.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/testing/cwd.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/testing/cwd.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/testing/env-exclusion.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/testing/env-exclusion.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/testing/mock-fetch.test.ts", ["network"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Verifies mutation and restoration of the shared fetch, resolver, and outbound transport boundaries.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/testing/mock-fetch.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/testing/testing.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/testing/testing.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/testing/timing.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/tool/context7.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/tool/data-properties.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4k",
    }),
    entry("src/tool/factory.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "agent-tools",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/tool/factory.test.ts",
      "removalPr": "PR 4k",
    }),
    entry("src/tool/remote-mcp.test.ts", ["process", "network"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/transforms/css-modules/naming.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/bundle-deps-validator.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/bundle-deps-validator.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/bundle-manifest.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/bundle-manifest.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/bundle-recovery.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/bundle-recovery.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/cached-bundle-validation.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/cached-bundle-validation.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/http-cache-helpers.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/http-cache.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises temporary or mutable filesystem state and belongs in integration coverage.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/http-cache.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/import-parser.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/import-parser.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/in-flight-manager.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/npm-registry-client.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/package-registry.test.ts", [
      "filesystem-write",
      "process",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/esm/package-registry.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/specifier-resolver.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/esm/transform-cache.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/transforms/import-rewriter/commonjs-policy.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/transforms/import-rewriter/core.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/import-rewriter/core.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/import-rewriter/dependency-resolution.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/import-rewriter/ssr-adapter.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/import-rewriter/strategies/bare-strategy.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/import-rewriter/strategies/react-strategy.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/transforms/import-rewriter/strategies/veryfront-strategy.test.ts",
      ["process"],
      {
        "disposition": "replaceable-fake",
        "owner": "core-runtime",
        "rationale":
          "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/transforms/mdx/compiler/frontmatter-extractor.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/mdx/compiler/mdx-compiler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/mdx/esm-module-loader/cache/index.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/cache/index.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/mdx/esm-module-loader/jsx-cache.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/jsx-cache.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/mdx/esm-module-loader/loader-helpers.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/loader-helpers.test.ts",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/dependency-recovery.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/distributed-cache.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/distributed-cache.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/framework-validator.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/framework-validator.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/http-fetcher.test.ts",
      ["filesystem-write", "network"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/http-fetcher.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/transforms/mdx/esm-module-loader/module-fetcher/index.test.ts", [
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/index.test.ts",
      "removalPr": "PR 4n",
    }),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/module-cache.test.ts",
      ["filesystem-read", "filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/module-cache.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/nested-imports.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/nested-imports.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry(
      "src/transforms/mdx/esm-module-loader/module-fetcher/path-cache-lookup.test.ts",
      ["filesystem-write"],
      {
        "disposition": "integration-relocation",
        "owner": "core-runtime",
        "rationale":
          "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
        "destination":
          "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-fetcher/path-cache-lookup.test.ts",
        "removalPr": "PR 4n",
      },
    ),
    entry("src/transforms/mdx/esm-module-loader/module-writer.test.ts", [
      "filesystem-write",
      "network",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/mdx/esm-module-loader/module-writer.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/mdx/esm-module-loader/utils/source-spans.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/mdx/index.test.ts", ["filesystem-write"], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/mdx/index.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/npm-import-rewrites.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/npm-import-rewrites.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/pipeline/__fixtures__/fixture-runner.test.ts", [
      "filesystem-read",
    ], unresolvedReadRelocation("core-runtime", "PR 4n")),
    entry("src/transforms/pipeline/cache-identity.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/pipeline/index.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/pipeline/stages/compile.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/pipeline/stages/ssr-vf-modules/transform.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "core-runtime",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/transforms/pipeline/stages/ssr-vf-modules/transform.test.ts",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/shared/server-only-packages.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4n",
    }),
    entry("src/transforms/shared/specifier-suffix.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "core-runtime",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4n",
    }),
    entry("src/utils/base64url.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/cache-dir.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/cache-dir.test.ts",
      "removalPr": "PR 4i",
    }),
    entry(
      "src/utils/constants/cdn.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("config-tooling", "PR 4i"),
    ),
    entry("src/utils/css-candidate-admission.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/env-loader.test.ts", ["filesystem-write", "process"], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/env-loader.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/feature-flags.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/file-discovery.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "shared-cwd",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/file-discovery.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/hash-utils.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/id.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/id.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/import-lockfile.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/import-lockfile.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/logger/logger.test.ts", ["process"], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/logger/logger.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/logger/redact.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/logger/serialization.test.ts", ["process", "shared-cwd"], {
      "disposition": "integration-relocation",
      "owner": "config-tooling",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/utils/logger/serialization.test.ts",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/memory/profiler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/response-body.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4i",
    }),
    entry("src/utils/retained-string.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "config-tooling",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4i",
    }),
    entry("src/workflow/api/workflow-client.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/blob/local-storage.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-tools",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/workflow/blob/local-storage.test.ts",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/blob/veryfront-cloud-storage.test.ts", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/claude-code/agent.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/claude-code/websocket-publisher.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/claude-code/workspace-sync.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "agent-tools",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/src/workflow/claude-code/workspace-sync.test.ts",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/context-serialization.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/executor/workflow-definition-snapshot.test.ts", [
      "process",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4k",
    }),
    entry(
      "src/workflow/executor/workflow-tracing.test.ts",
      ["filesystem-read", "process"],
      {
        "disposition": "replaceable-fake",
        "owner": "agent-tools",
        "rationale":
          "Mutates the process-global Math.random boundary and cannot run safely beside concurrent unit tests.",
        "replacement":
          "Inject a deterministic random source instead of assigning Math.random.",
        "removalPr": "PR 4k",
      },
    ),
    entry("src/workflow/http/handler.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, the shared working directory, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/react/use-workflow-start.test.tsx", [
      "process",
      "network",
    ], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Mutates the process-global fetch boundary and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject a fetch implementation or use a scoped per-test transport fake instead of assigning globalThis.fetch.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/registry.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary instead of mutating shared global runtime objects or intrinsic constructors and prototypes.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/worker/dynamic-run-entrypoint.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/worker/run-entrypoint.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry("src/workflow/worker/shared.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "agent-tools",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4k",
    }),
    entry(
      "templates/index.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("extensions-templates", "PR 4e"),
    ),
    entry("templates/integration-loader.test.ts", ["process"], {
      "disposition": "replaceable-fake",
      "owner": "extensions-templates",
      "rationale":
        "Depends on or mutates process-global environment/runtime state and cannot run safely beside concurrent unit tests.",
      "replacement":
        "Inject an environment/runtime-state boundary (and transport fake where applicable) instead of reading or mutating Deno.env, process.env, signals, exits, or global runtime objects.",
      "removalPr": "PR 4e",
    }),
    entry(
      "templates/manifest-artifact.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("extensions-templates", "PR 4e"),
    ),
    entry(
      "templates/scaffold-export.test.ts",
      ["filesystem-read"],
      unresolvedReadRelocation("extensions-templates", "PR 4e"),
    ),
    entry("templates/scaffold-parity.test.ts", [
      "filesystem-read",
      "filesystem-write",
    ], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/templates/scaffold-parity.test.ts",
      "removalPr": "PR 4e",
    }),
    entry("templates/scaffold-quality.test.ts", [
      "filesystem-read",
      "filesystem-write",
      "process",
    ], {
      "disposition": "integration-relocation",
      "owner": "extensions-templates",
      "rationale":
        "Exercises filesystem mutation, process, server, network, browser, or multi-component runtime behavior outside the colocated unit boundary.",
      "destination":
        "tests/integration/semantic-unit-boundary/templates/scaffold-quality.test.ts",
      "removalPr": "PR 4e",
    }),
  ]);

function entry(
  path: string,
  effects: readonly SemanticEffect[],
  metadata: EntryMetadata | UnresolvedReadRelocation,
): SemanticDispositionEntry {
  if (metadata.disposition === "unresolved-read-relocation") {
    return {
      path,
      effects,
      disposition: "integration-relocation",
      owner: metadata.owner,
      rationale:
        "Reads through an operand the semantic audit cannot prove repository-local; relocate until the dependency is explicit.",
      destination: `tests/integration/semantic-unit-boundary/${path}`,
      removalPr: metadata.removalPr,
    };
  }
  return { path, effects, ...metadata };
}

function unresolvedReadRelocation(
  owner: string,
  removalPr: string,
): UnresolvedReadRelocation {
  return {
    disposition: "unresolved-read-relocation",
    owner,
    removalPr,
  };
}
