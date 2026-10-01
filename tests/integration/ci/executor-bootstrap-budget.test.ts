import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { executorBootstrapTestPatterns } from "../agent/executor-node-bootstrap-groups.fixture.ts";

it("keeps cold executor installations inside independent child budgets without omitting coverage", () => {
  // Recorded integration CI costs from run 36805880628, rounded up. Cold
  // loader startup also consumes the wrapper's unchanged 25-second budget.
  const cases = [
    {
      name: "rejects missing first-party runtime contracts before reading an allocation key",
      cost: 2,
    },
    { name: "loads a real project only after fixed runtime installation", cost: 6000 },
    { name: "loads a real project only after fixed project-tools installation", cost: 4300 },
    { name: "loads a real project only after fixed http installation", cost: 11200 },
    { name: "accepts native Node when a Deno compatibility namespace is present", cost: 2 },
    { name: "rejects missing and noncanonical bootstrap values before reading a key", cost: 2 },
    { name: "requires the schema validator before key I/O", cost: 2 },
    { name: "rejects an expired allocation before key I/O", cost: 2 },
    { name: "expires during delayed key acquisition and wipes the late key", cost: 61 },
    { name: "rejects short or oversized keys, wipes them, and sanitizes reader errors", cost: 2 },
    {
      name: "reads only fixed environment names and exposes a ready authenticated echo channel",
      cost: 2,
    },
    { name: "rejects an incorrect key without resolving channel readiness", cost: 2 },
    { name: "close before attachment settles readiness and releases listeners", cost: 2 },
    { name: "close after attachment aborts a pending operation and both channels", cost: 2 },
    { name: "abort before attachment settles readiness and releases listeners", cost: 2 },
    { name: "abort after attachment aborts a pending operation and both channels", cost: 2 },
    { name: "aborts pending key acquisition and wipes bytes from a late reader", cost: 2 },
    { name: "rejects already-aborted startup before reading a key", cost: 2 },
    { name: "accepts the maximum canonical generation and workload lifetime", cost: 2 },
    { name: "enforces the validated workload lifetime before attachment", cost: 1002 },
    {
      name: "limits authenticated channel readiness to the absolute allocation deadline",
      cost: 100,
    },
    { name: "caps channel calls and closes attached I/O at the allocation deadline", cost: 200 },
  ];
  const coldStartup = 3_000;
  const childBudget = 25_000;
  assert(
    coldStartup + cases.reduce((sum, test) => sum + test.cost, 0) > childBudget,
    "The recorded aggregate workload must reproduce the old child cancellation",
  );
  const suite = "fixed Node executor bootstrap";
  const patterns = executorBootstrapTestPatterns().map((pattern) => new RegExp(pattern));
  assertEquals(
    patterns.some((pattern) => pattern.test(suite)),
    false,
    "Matching the suite bypasses child filtering",
  );
  for (const test of cases) {
    assertEquals(
      patterns.filter((pattern) => pattern.test(`${suite} ${test.name}`)).length,
      1,
      test.name,
    );
  }
  assertEquals(
    patterns.map((pattern) => cases.filter((test) => pattern.test(`${suite} ${test.name}`)).length),
    [1, 1, 1, 19],
  );
  for (const pattern of patterns) {
    const selected = cases.filter((test) => pattern.test(`${suite} ${test.name}`));
    assert(selected.length > 0);
    const elapsed = coldStartup + selected.reduce((sum, test) => sum + test.cost, 0);
    assert(
      elapsed < childBudget,
      `Cold native test group needs ${elapsed}ms, exceeds its 25000ms budget`,
    );
  }
});
