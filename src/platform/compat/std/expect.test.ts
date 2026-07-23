import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "./expect.ts";

class ExpectedError extends Error {}
class DifferentError extends Error {}

describe("platform/compat/std/expect", () => {
  it("treats an undefined property value as absent", () => {
    expect(() => expect({ value: undefined }).toHaveProperty("value")).toThrow();
  });

  it("matches nested object subsets recursively", () => {
    expect({ nested: { retained: true, extra: true } }).toMatchObject({
      nested: { retained: true },
    });
  });

  it("matches Error instances by constructor and message", () => {
    expect(() => {
      expect(() => {
        throw new DifferentError("same message");
      }).toThrow(new ExpectedError("same message"));
    }).toThrow();

    expect(() => {
      throw new ExpectedError("same message");
    }).toThrow(new ExpectedError("same message"));
  });

  it("applies Error instance matching to rejected promises", async () => {
    await expect(
      expect(Promise.reject(new DifferentError("same message"))).rejects.toThrow(
        new ExpectedError("same message"),
      ),
    ).rejects.toThrow();

    await expect(Promise.reject(new ExpectedError("same message"))).rejects.toThrow(
      new ExpectedError("same message"),
    );
  });
});
