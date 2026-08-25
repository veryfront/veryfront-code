import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  isValidProviderSafeSkillId,
  isValidSkillName,
  isValidStrictSkillName,
  SKILL_NAME_REGEX,
  SKILL_PROVIDER_SAFE_ID_REGEX,
  SKILL_STRICT_NAME_REGEX,
} from "./types.ts";

Deno.test("skill name admission is independent of public regex and prototype mutation", () => {
  const publicMatchers = [
    SKILL_NAME_REGEX,
    SKILL_STRICT_NAME_REGEX,
    SKILL_PROVIDER_SAFE_ID_REGEX,
  ];
  const originalSources = publicMatchers.map((matcher) => matcher.source);
  const originalTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test");
  let results: readonly boolean[] = [];

  try {
    for (const matcher of publicMatchers) matcher.compile(".*");
    Object.defineProperty(RegExp.prototype, "test", {
      configurable: true,
      value: () => true,
      writable: true,
    });
    results = [
      isValidSkillName("valid-name"),
      isValidSkillName("INVALID"),
      isValidStrictSkillName("valid-name"),
      isValidStrictSkillName("invalid--name"),
      isValidProviderSafeSkillId("owner--skill_1"),
      isValidProviderSafeSkillId("owner/skill"),
      isValidSkillName(null),
    ];
  } finally {
    if (originalTest) Object.defineProperty(RegExp.prototype, "test", originalTest);
    publicMatchers.forEach((matcher, index) => matcher.compile(originalSources[index]!));
  }

  assertEquals(results, [true, false, true, false, true, false, false]);
});
