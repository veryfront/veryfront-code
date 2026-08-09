import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { assertEquals } from "./assert.ts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "./bdd.ts";

const TEST_ENV_KEY = "VF_TEST_AFTER_EACH_ENV_OVERLAY";
const originalValue = getEnv(TEST_ENV_KEY);
const BEFORE_EACH_ENV_KEY = "VF_TEST_BEFORE_EACH_ENV_OVERLAY";
const originalBeforeEachValue = getEnv(BEFORE_EACH_ENV_KEY);
const SUITE_ENV_KEY = "VF_TEST_SUITE_ENV_OVERLAY";
const originalSuiteValue = getEnv(SUITE_ENV_KEY);
const OUTER_SUITE_ENV_KEY = "VF_TEST_OUTER_SUITE_ENV_OVERLAY";
const INNER_SUITE_ENV_KEY = "VF_TEST_INNER_SUITE_ENV_OVERLAY";

describe("BDD environment overlay", { ignore: !isDeno }, () => {
  afterEach(() => {
    setEnv(TEST_ENV_KEY, "after-each-value");
  });

  afterAll(() => {
    if (originalValue === undefined) {
      deleteEnv(TEST_ENV_KEY);
    } else {
      setEnv(TEST_ENV_KEY, originalValue);
    }
  });

  it("isolates environment changes made by a test", () => {
    setEnv(TEST_ENV_KEY, "test-value");
    assertEquals(getEnv(TEST_ENV_KEY), "test-value");
  });

  it("does not expose environment changes made by afterEach", () => {
    assertEquals(getEnv(TEST_ENV_KEY), originalValue);
  });
});

describe("BDD beforeEach environment overlay", { ignore: !isDeno }, () => {
  beforeEach(() => {
    setEnv(BEFORE_EACH_ENV_KEY, "before-each-value");
  });

  it("makes beforeEach environment changes visible to the test", () => {
    assertEquals(getEnv(BEFORE_EACH_ENV_KEY), "before-each-value");
  });
});

describe("BDD suite environment isolation", { ignore: !isDeno }, () => {
  afterAll(() => {
    if (originalBeforeEachValue === undefined) {
      deleteEnv(BEFORE_EACH_ENV_KEY);
    } else {
      setEnv(BEFORE_EACH_ENV_KEY, originalBeforeEachValue);
    }
  });

  it("does not expose environment changes made by another suite's beforeEach", () => {
    assertEquals(getEnv(BEFORE_EACH_ENV_KEY), originalBeforeEachValue);
  });
});

describe("BDD suite-wide environment", { ignore: !isDeno }, () => {
  beforeAll(() => {
    setEnv(SUITE_ENV_KEY, "suite-value");
  });

  afterAll(() => {
    assertEquals(getEnv(SUITE_ENV_KEY), "suite-value");
    if (originalSuiteValue === undefined) {
      deleteEnv(SUITE_ENV_KEY);
    } else {
      setEnv(SUITE_ENV_KEY, originalSuiteValue);
    }
  });

  it("makes beforeAll environment changes visible to tests", () => {
    assertEquals(getEnv(SUITE_ENV_KEY), "suite-value");
  });
});

describe("BDD nested suite-wide environment", { ignore: !isDeno }, () => {
  beforeAll(() => {
    setEnv(OUTER_SUITE_ENV_KEY, "outer-value");
  });

  describe("nested suite", () => {
    beforeAll(() => {
      setEnv(INNER_SUITE_ENV_KEY, "inner-value");
    });

    it("inherits outer values and adds nested values", () => {
      assertEquals(getEnv(OUTER_SUITE_ENV_KEY), "outer-value");
      assertEquals(getEnv(INNER_SUITE_ENV_KEY), "inner-value");
    });
  });

  it("does not expose nested beforeAll changes to the parent suite", () => {
    assertEquals(getEnv(OUTER_SUITE_ENV_KEY), "outer-value");
    assertEquals(getEnv(INNER_SUITE_ENV_KEY), undefined);
  });
});

describe("BDD suite-wide environment cleanup", { ignore: !isDeno }, () => {
  afterAll(() => {
    if (originalSuiteValue === undefined) {
      deleteEnv(SUITE_ENV_KEY);
    } else {
      setEnv(SUITE_ENV_KEY, originalSuiteValue);
    }
  });

  it("does not expose environment changes made by another suite's beforeAll", () => {
    assertEquals(getEnv(SUITE_ENV_KEY), originalSuiteValue);
  });
});
