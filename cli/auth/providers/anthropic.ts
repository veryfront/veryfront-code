import { logError, logSuccess, promptPassword } from "../../utils/index.ts";
import { type ProviderCredential, saveProviderToken } from "../provider-store.ts";
import { dim } from "../../ui/colors.ts";

export async function loginAnthropic(): Promise<boolean> {
  console.log(`\n  Enter your Anthropic API key.`);
  console.log(
    `  ${dim("Get one at: https://console.anthropic.com/settings/keys")}\n`,
  );

  const apiKey = promptPassword("  API key: ");
  if (!apiKey) {
    logError("No API key provided.");
    return false;
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!resp.ok) {
      logError(
        `Invalid API key (HTTP ${resp.status}). Check your key at console.anthropic.com`,
      );
      return false;
    }
  } catch (e) {
    logError(
      `Failed to validate key: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }

  const credential: ProviderCredential = {
    apiKey,
    validatedAt: new Date().toISOString(),
    provider: "anthropic",
  };
  await saveProviderToken("anthropic", credential);
  logSuccess("Anthropic API key configured");
  return true;
}
