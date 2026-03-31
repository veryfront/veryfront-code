import { logError, logSuccess, promptPassword } from "../../utils/index.ts";
import { type ProviderCredential, saveProviderToken } from "../provider-store.ts";
import { dim } from "../../ui/colors.ts";

export async function loginOpenAI(baseUrl?: string): Promise<boolean> {
  console.log(`\n  Enter your OpenAI API key.`);
  console.log(
    `  ${dim("Get one at: https://platform.openai.com/api-keys")}\n`,
  );

  const apiKey = promptPassword("  API key: ");
  if (!apiKey) {
    logError("No API key provided.");
    return false;
  }

  const endpoint = baseUrl ?? "https://api.openai.com";

  try {
    const resp = await fetch(`${endpoint}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      logError(
        `Invalid API key (HTTP ${resp.status}). Check your key at platform.openai.com`,
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
    provider: "openai",
  };
  await saveProviderToken("openai", credential);
  logSuccess("OpenAI API key configured");
  return true;
}
