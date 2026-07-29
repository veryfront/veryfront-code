import { assertEquals } from "@std/assert";
import extSentry, {
  createDenoSentryApplicationErrorReporter,
  createSentryApplicationErrorReporter,
} from "./index.ts";

Deno.test("root export preserves the V1 Deno reporter factory name", () => {
  assertEquals(createSentryApplicationErrorReporter, createDenoSentryApplicationErrorReporter);
});

Deno.test("root export keeps extension metadata available", () => {
  assertEquals(extSentry().name, "ext-observability-sentry");
  assertEquals(extSentry().capabilities, [
    { type: "net:outbound", hosts: ["*"] },
  ]);
});
