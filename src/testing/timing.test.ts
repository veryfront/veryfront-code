import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { assertEquals } from "./assert.ts";
import { afterEach, describe, it } from "./bdd.ts";
import { getTestTimeScale, scaleMs } from "./timing.ts";

const TEST_TIME_SCALE_ENV = "VF_TEST_TIME_SCALE";

describe("testing/timing", () => {
  afterEach(() => deleteEnv(TEST_TIME_SCALE_ENV));

  it("uses the default scale when the environment value is absent or invalid", () => {
    deleteEnv(TEST_TIME_SCALE_ENV);
    assertEquals(getTestTimeScale(), 1, "missing scale should use the default");

    for (const value of ["", "0", "-1", "NaN", "Infinity"]) {
      setEnv(TEST_TIME_SCALE_ENV, value);
      assertEquals(getTestTimeScale(), 1, `${value || "empty"} should use the default`);
    }
  });

  it("reads the current positive scale on every call", () => {
    setEnv(TEST_TIME_SCALE_ENV, "0.25");
    assertEquals(getTestTimeScale(), 0.25);
    assertEquals(scaleMs(100), 25);

    setEnv(TEST_TIME_SCALE_ENV, "2");
    assertEquals(getTestTimeScale(), 2);
    assertEquals(scaleMs(100), 200);
  });

  it("rounds scaled durations and enforces the requested minimum", () => {
    setEnv(TEST_TIME_SCALE_ENV, "0.25");

    assertEquals(scaleMs(10), 3, "scaled durations should use Math.round");
    assertEquals(scaleMs(1), 1, "the default minimum should be one millisecond");
    assertEquals(scaleMs(1, 5), 5, "the caller-provided minimum should be honored");
  });
});
