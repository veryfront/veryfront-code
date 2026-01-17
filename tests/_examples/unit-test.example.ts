/**
 * EXAMPLE: Unit Test Best Practices
 *
 * This file demonstrates proper unit testing patterns in Veryfront.
 * Copy this structure for new unit tests.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd.ts";
import { TEST_TIMEOUTS } from "../_helpers/constants.ts";

/**
 * Example: Testing a simple utility function
 */
describe("Example Unit Test - Pure Functions", () => {
  /**
   * Example function to test
   */
  function slugify(text: string): string {
    return text.toLowerCase().replace(/\s+/g, "-");
  }

  it("should convert text to lowercase slug", () => {
    // Arrange
    const input = "Hello World";
    const expected = "hello-world";

    // Act
    const result = slugify(input);

    // Assert
    assertEquals(
      result,
      expected,
      "Should convert spaces to hyphens and lowercase all characters",
    );
  });

  it("should handle multiple spaces", () => {
    const result = slugify("Hello    World");
    assertEquals(result, "hello-world", "Should collapse multiple spaces into single hyphen");
  });

  it("should handle empty string", () => {
    const result = slugify("");
    assertEquals(result, "", "Should handle empty strings without errors");
  });
});

/**
 * Example: Testing a class with state
 */
describe("Example Unit Test - Stateful Class", () => {
  class Counter {
    private count = 0;

    increment(): number {
      return ++this.count;
    }

    decrement(): number {
      return --this.count;
    }

    reset(): void {
      this.count = 0;
    }

    getValue(): number {
      return this.count;
    }
  }

  it("should increment counter", () => {
    // Arrange
    const counter = new Counter();

    // Act
    const result = counter.increment();

    // Assert
    assertEquals(result, 1, "First increment should return 1");
    assertEquals(counter.getValue(), 1, "Counter value should be 1");
  });

  it("should handle multiple operations", () => {
    const counter = new Counter();

    counter.increment(); // 1
    counter.increment(); // 2
    counter.decrement(); // 1
    const result = counter.getValue();

    assertEquals(result, 1, "Counter should be 1 after increment, increment, decrement");
  });

  it("should reset to zero", () => {
    const counter = new Counter();
    counter.increment();
    counter.increment();

    counter.reset();

    assertEquals(counter.getValue(), 0, "Reset should set counter to 0");
  });
});

/**
 * Example: Testing async functions
 */
describe("Example Unit Test - Async Operations", () => {
  async function fetchUserData(id: number): Promise<{ id: number; name: string }> {
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (id < 1) {
      throw new Error("Invalid user ID");
    }

    return {
      id,
      name: `User ${id}`,
    };
  }

  it("should fetch user data", async () => {
    // Act
    const user = await fetchUserData(123);

    // Assert
    assertExists(user, "User should exist");
    assertEquals(user.id, 123, "User ID should match requested ID");
    assertEquals(user.name, "User 123", "User name should be generated correctly");
  });

  it("should throw error for invalid ID", async () => {
    // Assert - use assertRejects for async errors
    await assertRejects(
      async () => await fetchUserData(0),
      Error,
      "Invalid user ID",
      "Should throw error for invalid user ID",
    );
  });

  // With timeout configuration
  it(
    "should complete within time budget",
    { timeout: TEST_TIMEOUTS.UNIT },
    async () => {
      const start = performance.now();
      await fetchUserData(1);
      const duration = performance.now() - start;

      assertEquals(
        duration < 100,
        true,
        `Operation took ${duration.toFixed(2)}ms, should be under 100ms`,
      );
    },
  );
});

/**
 * Example: Testing error conditions
 */
describe("Example Unit Test - Error Handling", () => {
  function divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error("Division by zero");
    }
    return a / b;
  }

  it("should divide numbers correctly", () => {
    const result = divide(10, 2);
    assertEquals(result, 5, "10 divided by 2 should equal 5");
  });

  it("should throw error on division by zero", () => {
    const divideByZero = () => divide(10, 0);

    // Use assertThrows for synchronous errors
    let errorThrown = false;
    try {
      divideByZero();
    } catch (error) {
      errorThrown = true;
      assertEquals(
        (error as Error).message,
        "Division by zero",
        "Should throw with correct error message",
      );
    }

    assertEquals(errorThrown, true, "Should throw an error");
  });

  it("should handle edge cases", () => {
    assertEquals(divide(0, 5), 0, "Zero divided by anything should be zero");
    assertEquals(divide(-10, 2), -5, "Should handle negative numbers");
    assertEquals(divide(1, 3), 0.3333333333333333, "Should handle decimal results");
  });
});

/**
 * Example: Using test fixtures
 */
describe("Example Unit Test - Test Fixtures", () => {
  // Test fixture: Reusable test data
  const TEST_USERS = [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
    { id: 3, name: "Charlie", role: "user" },
  ] as const;

  function filterByRole(
    users: typeof TEST_USERS,
    role: string,
  ): typeof TEST_USERS[number][] {
    return users.filter((u) => u.role === role);
  }

  it("should filter users by role", () => {
    const admins = filterByRole(TEST_USERS, "admin");

    assertEquals(admins.length, 1, "Should find 1 admin");
    assertEquals(admins[0]!.name, "Alice", "Admin should be Alice");
  });

  it("should return empty array for non-existent role", () => {
    const result = filterByRole(TEST_USERS, "superadmin");
    assertEquals(result.length, 0, "Should return empty array for non-existent role");
  });
});

/**
 * Best Practices Checklist:
 * ✅ Use describe/it BDD style
 * ✅ Follow Arrange-Act-Assert pattern
 * ✅ Include descriptive test names
 * ✅ Add assertion messages explaining what's being tested
 * ✅ Test both happy paths and error cases
 * ✅ Use appropriate timeouts for async tests
 * ✅ Keep tests independent and isolated
 * ✅ Use test fixtures for reusable data
 * ✅ Document complex test scenarios
 */
