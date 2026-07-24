import { assertEquals } from "#veryfront/testing/assert.ts";
import type { CorsOptions, CorsValidationResult, OriginValidator } from "./types.ts";
import type { CorsOptions as PublicCorsOptions } from "veryfront/middleware";

type LegacyOriginValidator = (
  origin: string,
) => boolean | Promise<boolean>;

function consumeLegacyCorsOptions(
  options: CorsOptions | PublicCorsOptions,
): LegacyOriginValidator | undefined {
  return typeof options.origin === "function" ? options.origin : undefined;
}

function consumeLegacyOriginValidator(
  validator: OriginValidator,
): LegacyOriginValidator {
  return validator;
}

function consumeLegacyValidationResult(
  result: CorsValidationResult,
): {
  allowedOrigin: string | null;
  allowCredentials: boolean;
  error?: string;
} {
  return result;
}

Deno.test("middleware CORS declarations preserve their legacy consumer contract", () => {
  const validator = consumeLegacyCorsOptions({
    origin: async (origin) => origin === "https://example.com",
  });
  const exactValidator = consumeLegacyOriginValidator(
    (origin) => origin === "https://example.com",
  );
  const result = consumeLegacyValidationResult({
    allowedOrigin: null,
    allowCredentials: false,
  });

  assertEquals(validator?.("https://example.com") instanceof Promise, true);
  assertEquals(exactValidator("https://example.com"), true);
  assertEquals(result.allowedOrigin, null);
});

Deno.test("public middleware docs retain the CorsOptions interface properties", async () => {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["doc", "--json", "--frozen", "src/middleware/index.ts"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(output.success, true, new TextDecoder().decode(output.stderr));

  const document = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    nodes: Array<{
      name?: string;
      kind?: string;
      interfaceDef?: { properties?: Array<{ name?: string }> };
    }>;
  };
  const corsOptions = document.nodes.find((node) => node.name === "CorsOptions");

  assertEquals(corsOptions?.kind, "interface");
  assertEquals(
    corsOptions?.interfaceDef?.properties?.map((property) => property.name),
    [
      "origin",
      "methods",
      "allowedHeaders",
      "exposedHeaders",
      "credentials",
      "maxAge",
    ],
  );
});
