import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildTestProcessEnv,
  DENO_TEST_ENV,
  hasDenoPermissionFlag,
  LEAF_TEST_SUITES,
  PROVIDER_ENV_KEYS,
  resolveLeafSuiteOwners,
  validateLeafSuiteRegistry,
} from "./suites.ts";

describe("leaf test suite registry", () => {
  it("recognizes forwarded Deno permission flags without scanning script arguments", () => {
    for (
      const args of [
        ["--allow-all"],
        ["--allow-net=api.openai.com"],
        ["--deny-net", "localhost"],
        ["-A"],
        ["-I"],
        ["-N"],
        ["-P"],
      ]
    ) {
      assertEquals(hasDenoPermissionFlag(args), true);
    }
    assertEquals(hasDenoPermissionFlag(["--filter", "unit"]), false);
    assertEquals(hasDenoPermissionFlag(["--", "--allow-all"]), false);
  });

  it("removes every provider credential while preserving benign parent values", () => {
    const parentEnv = Object.fromEntries([
      ...PROVIDER_ENV_KEYS.map((key) => [key, "test-only-value"]),
      ["PATH", "/test/bin"],
    ]);

    const env = buildTestProcessEnv(parentEnv, DENO_TEST_ENV);

    assertEquals(env.PATH, "/test/bin");
    assertEquals(env.DENO_TESTING, "1");
    for (const key of PROVIDER_ENV_KEYS) assertEquals(env[key], undefined);
  });

  it("scrubs credentials whose inherited names differ only by case", () => {
    // Windows environment names are case-insensitive, so an exact-case delete
    // would leave OpenAI_Api_Key readable through Deno.env.get("OPENAI_API_KEY").
    const env = buildTestProcessEnv({
      OpenAI_Api_Key: "test-only-value",
      anthropic_api_key: "test-only-value",
      PATH: "/test/bin",
    });

    assertEquals(env.OpenAI_Api_Key, undefined);
    assertEquals(env.anthropic_api_key, undefined);
    assertEquals(env.PATH, "/test/bin");
  });

  it("scrubs case variants of hook Git configuration without removing GitHub CI context", () => {
    const env = buildTestProcessEnv({
      Git_Dir: "/checkout/.git",
      git_config_count: "1",
      Git_Config_Key_0: "core.bare",
      Git_Config_Value_0: "true",
      GITHUB_WORKSPACE: "/checkout",
      GIT_AUTHOR_NAME: "Fixture Author",
      GIT_CONFIG_GLOBAL: "/fixture/global.config",
    });
    assertEquals(env, {
      GITHUB_WORKSPACE: "/checkout",
      GIT_AUTHOR_NAME: "Fixture Author",
      GIT_CONFIG_GLOBAL: "/fixture/global.config",
    });
  });

  it("records runtime as one suite with variants, ownership, and support exclusions", () => {
    // Production break caught: node and bun runtime tests can drift into
    // competing leaf owners instead of one runtime suite with runner variants.
    const runtimeSuites = LEAF_TEST_SUITES.filter((suite) =>
      suite.id === "runtime"
    );

    assertEquals(runtimeSuites.length, 1);
    assertEquals(runtimeSuites[0], {
      id: "runtime",
      level: "unit",
      pathSelectors: [],
      runner: "deno",
      prOwner: "test-architecture",
      scheduledOwner: "runtime-compat",
      supportExclusions: ["tests/**/fixtures/**", "tests/**/support/**"],
      runtimeVariants: [
        { id: "node", runner: "node", owner: "runtime-compat" },
        { id: "bun", runner: "bun", owner: "runtime-compat" },
      ],
    });
  });

  it("rejects duplicate canonical owners for one executable test path", () => {
    // Production break caught: overlapping canonical ownership silently lets
    // one file appear in multiple canonical leaf suites.
    assertThrows(
      () =>
        validateLeafSuiteRegistry([
          {
            id: "unit",
            level: "unit",
            pathSelectors: ["src/"],
            runner: "deno",
            prOwner: "test-architecture",
            supportExclusions: [],
          },
          {
            id: "integration",
            level: "integration",
            pathSelectors: ["src/agent/"],
            runner: "deno",
            prOwner: "test-architecture",
            supportExclusions: [],
          },
        ]),
      Error,
      "multiple canonical owners",
    );
  });

  it("rejects suite records that inherit required fields", () => {
    const suite = Object.create({
      pathSelectors: ["src/"],
    });
    Object.assign(suite, {
      id: "unit",
      level: "unit",
      runner: "deno",
      prOwner: "test-architecture",
      supportExclusions: [],
    });

    assertThrows(
      () => validateLeafSuiteRegistry([suite]),
      Error,
      "must own pathSelectors",
    );
  });

  it("rejects inherited selector keys instead of treating them as canonical owners", () => {
    const pathSelectors = Object.create({ 0: "src/extra/" });
    Object.defineProperty(pathSelectors, "length", {
      value: 1,
      enumerable: false,
    });

    assertThrows(
      () =>
        validateLeafSuiteRegistry([
          {
            id: "unit",
            level: "unit",
            pathSelectors,
            runner: "deno",
            prOwner: "test-architecture",
            supportExclusions: [],
          },
        ]),
      Error,
      "pathSelectors must be an array",
    );
  });

  it("resolves canonical unit roots using real path matching", () => {
    // Production break caught: the approved colocated unit roots are recorded
    // in docs but the runtime matcher still treats them as migration paths.
    assertEquals(resolveLeafSuiteOwners("src/agent/factory.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(resolveLeafSuiteOwners("cli/router.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(
      resolveLeafSuiteOwners(
        "extensions/ext-bundler-esbuild/src/binary.test.ts",
      ),
      [{ level: "unit", suite: "unit", runner: "deno" }],
    );
    assertEquals(resolveLeafSuiteOwners("templates/scaffold-parity.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(resolveLeafSuiteOwners("scripts/test/test-layout.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
    assertEquals(resolveLeafSuiteOwners("react/react.test.ts"), [
      { level: "unit", suite: "unit", runner: "deno" },
    ]);
  });
});
