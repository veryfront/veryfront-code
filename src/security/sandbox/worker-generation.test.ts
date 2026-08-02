import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  digestWorkerGenerationMaterial,
  isWorkerGenerationInScope,
  resolveWorkerGeneration,
  snapshotWorkerGenerationIdentity,
} from "./worker-generation.ts";

Deno.test("worker generation identities are exact, bounded, and deterministic", async () => {
  assertEquals(snapshotWorkerGenerationIdentity(undefined, undefined), undefined);
  assertThrows(
    () => snapshotWorkerGenerationIdentity("scope", undefined),
    TypeError,
    "must be supplied together",
  );
  assertThrows(
    () => snapshotWorkerGenerationIdentity(undefined, "release"),
    TypeError,
    "must be supplied together",
  );
  assertThrows(
    () => snapshotWorkerGenerationIdentity("", "release"),
    TypeError,
    "scopeId must be a non-empty string",
  );
  assertThrows(
    () => snapshotWorkerGenerationIdentity("scope", "x".repeat(1025)),
    TypeError,
    "generationId must be a non-empty string",
  );
  await assertRejects(
    () => resolveWorkerGeneration("invalid" as never),
    TypeError,
    'must be "api", "data", or "ssr"',
  );

  const identity = snapshotWorkerGenerationIdentity("data-scope", "release-a");
  const first = await resolveWorkerGeneration("data", identity);
  const again = await resolveWorkerGeneration("data", identity);
  const ssr = await resolveWorkerGeneration("ssr", identity);
  const changed = await resolveWorkerGeneration(
    "data",
    snapshotWorkerGenerationIdentity("data-scope", "release-b"),
  );

  assertEquals(first, again);
  assertMatch(
    first.workerId,
    /^veryfront-worker:v1:kind=4:data:scope=\d+:[A-Za-z0-9_-]+:generation=64:[0-9a-f]{64}$/,
  );
  assertEquals(first.reusable, true);
  assertNotEquals(changed.workerId, first.workerId);
  assertNotEquals(ssr.workerId, first.workerId);
  assertEquals(isWorkerGenerationInScope(first.workerId, "data-scope"), true);
  assertEquals(isWorkerGenerationInScope(ssr.workerId, "data-scope"), true);
  assertEquals(first.workerId.includes("data-scope"), false);
});

Deno.test("unversioned worker generations are single-use", async () => {
  const first = await resolveWorkerGeneration("ssr");
  const second = await resolveWorkerGeneration("ssr");

  assertMatch(first.workerId, /^ssr-ephemeral-[0-9a-f-]{36}$/);
  assertEquals(first.reusable, false);
  assertNotEquals(second.workerId, first.workerId);
  assertEquals(isWorkerGenerationInScope(first.workerId, "scope"), false);
});

Deno.test("scope matching is exact for delimiters and nested scope names", async () => {
  const parentScope = "tenant";
  const nestedScope = "tenant:generation:child";
  const delimitedScope = "tenant|scope=4:data:雪";
  const generationId = "release:generation:v1";

  const parent = await resolveWorkerGeneration(
    "data",
    snapshotWorkerGenerationIdentity(parentScope, generationId),
  );
  const nested = await resolveWorkerGeneration(
    "data",
    snapshotWorkerGenerationIdentity(nestedScope, generationId),
  );
  const delimited = await resolveWorkerGeneration(
    "ssr",
    snapshotWorkerGenerationIdentity(delimitedScope, generationId),
  );

  assertNotEquals(parent.workerId, nested.workerId);
  assertEquals(isWorkerGenerationInScope(parent.workerId, parentScope), true);
  assertEquals(isWorkerGenerationInScope(parent.workerId, nestedScope), false);
  assertEquals(isWorkerGenerationInScope(nested.workerId, nestedScope), true);
  assertEquals(isWorkerGenerationInScope(nested.workerId, parentScope), false);
  assertEquals(isWorkerGenerationInScope(delimited.workerId, delimitedScope), true);
  assertEquals(isWorkerGenerationInScope(delimited.workerId, `${delimitedScope}:child`), false);
});

Deno.test("API worker generations use framed identities with exact scope ownership", async () => {
  const scope = "api:tenant";
  const siblingScope = "api:tenant-other";
  const nestedScope = `${scope}:child`;
  const generation = await resolveWorkerGeneration(
    "api",
    snapshotWorkerGenerationIdentity(scope, "release-a"),
  );
  const nestedGeneration = await resolveWorkerGeneration(
    "api",
    snapshotWorkerGenerationIdentity(nestedScope, "release-a"),
  );
  const malformedGeneration = `${generation.workerId.slice(0, -1)}z`;

  assertMatch(
    generation.workerId,
    /^veryfront-worker:v1:kind=3:api:scope=\d+:[A-Za-z0-9_-]+:generation=64:[0-9a-f]{64}$/,
  );
  assertEquals(isWorkerGenerationInScope(generation.workerId, scope), true);
  assertEquals(isWorkerGenerationInScope(generation.workerId, siblingScope), false);
  assertEquals(isWorkerGenerationInScope(generation.workerId, nestedScope), false);
  assertEquals(isWorkerGenerationInScope(nestedGeneration.workerId, scope), false);
  assertEquals(isWorkerGenerationInScope(malformedGeneration, scope), false);
});

Deno.test("worker identity preserves otherwise-replaced UTF-16 code units", async () => {
  const loneSurrogate = "\ud800";
  const replacementCharacter = "\ufffd";
  const surrogateScope = await resolveWorkerGeneration(
    "data",
    snapshotWorkerGenerationIdentity(loneSurrogate, loneSurrogate),
  );
  const replacementScope = await resolveWorkerGeneration(
    "data",
    snapshotWorkerGenerationIdentity(replacementCharacter, replacementCharacter),
  );
  const replacementGeneration = await resolveWorkerGeneration(
    "data",
    snapshotWorkerGenerationIdentity(loneSurrogate, replacementCharacter),
  );

  assertNotEquals(surrogateScope.workerId, replacementScope.workerId);
  assertNotEquals(surrogateScope.workerId, replacementGeneration.workerId);
  assertEquals(isWorkerGenerationInScope(surrogateScope.workerId, loneSurrogate), true);
  assertEquals(
    isWorkerGenerationInScope(surrogateScope.workerId, replacementCharacter),
    false,
  );
});

Deno.test("semantic generation digests preserve otherwise-replaced UTF-16 code units", async () => {
  assertNotEquals(
    await digestWorkerGenerationMaterial("\ud800"),
    await digestWorkerGenerationMaterial("\ufffd"),
  );
});

Deno.test("unframed generation identities are never treated as pool keys", () => {
  const scope = "api:scope";
  assertEquals(
    isWorkerGenerationInScope(`${scope}:generation:${"a".repeat(64)}`, scope),
    false,
  );
});
