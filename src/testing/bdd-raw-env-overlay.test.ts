import { assertEquals } from "./assert.ts";
import { describe, it } from "./bdd.ts";

const key = "VF_TEST_BDD_RAW_ENV_OVERLAY";
const original = process.env[key];

it("isolates environment changes in a root-level test body", () => {
  process.env[key] = "root-test";
  assertEquals(process.env[key], "root-test");
});

it("restores the environment after a root-level test body", () => {
  assertEquals(process.env[key], original);
});

const crossScopeKey = "VF_TEST_BDD_CROSS_SCOPE_ENV_OVERLAY";
let markSuiteStarted: (() => void) | undefined;
const suiteStarted = new Promise<void>((resolve) => {
  markSuiteStarted = resolve;
});
let releaseSuite: (() => void) | undefined;
const suiteRelease = new Promise<void>((resolve) => {
  releaseSuite = resolve;
});
let suiteFinished = false;

describe("BDD root and suite environment ownership", () => {
  it("keeps the suite environment while a root test is eligible to run", async () => {
    process.env[crossScopeKey] = "suite";
    markSuiteStarted?.();

    await Promise.race([
      suiteRelease,
      new Promise<void>((resolve) => setTimeout(resolve, 50)),
    ]);

    assertEquals(process.env[crossScopeKey], "suite");
    suiteFinished = true;
  });
});

it("does not borrow an unrelated active suite environment scope", async () => {
  await suiteStarted;
  const overlappedSuite = !suiteFinished;

  process.env[crossScopeKey] = "root";
  if (overlappedSuite) releaseSuite?.();

  await Promise.resolve();
  assertEquals(process.env[crossScopeKey], "root");
});
