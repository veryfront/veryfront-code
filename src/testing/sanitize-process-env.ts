/** Remove credentials and provider routing from the real test-process environment. */
import { TEST_SENSITIVE_ENV_KEYS } from "./test-sensitive-env-keys.ts";

for (const key of TEST_SENSITIVE_ENV_KEYS) Deno.env.delete(key);
