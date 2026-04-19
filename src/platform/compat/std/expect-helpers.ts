import { deepEquals, safeStringify } from "#veryfront/testing/utils.ts";

export type PromiseRejectionResult = {
  rejected: boolean;
  error: unknown;
};

export function assertExpectation(
  condition: boolean,
  isNot: boolean,
  message: string,
): void {
  const result = isNot ? !condition : condition;
  if (!result) throw new Error(message);
}

export function selectExpectationMessage(
  positive: string,
  negative: string,
  isNot: boolean,
): string {
  return isNot ? negative : positive;
}

export function assertDeepEqualityMatch<T>(
  actual: T,
  expected: T,
  comparison: "equal" | "strictly equal",
  isNot: boolean,
): void {
  assertExpectation(
    deepEquals(actual, expected),
    isNot,
    selectExpectationMessage(
      `Expected ${safeStringify(actual)} to ${comparison} ${safeStringify(expected)}`,
      `Expected ${safeStringify(actual)} not to ${comparison} ${safeStringify(expected)}`,
      isNot,
    ),
  );
}

export async function getPromiseRejection(
  actual: Promise<unknown>,
): Promise<PromiseRejectionResult> {
  try {
    await actual;
    return { rejected: false, error: undefined };
  } catch (error) {
    return { rejected: true, error };
  }
}
