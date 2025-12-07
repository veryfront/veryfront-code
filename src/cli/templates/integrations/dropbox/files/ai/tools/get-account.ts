import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatFileSize, getCurrentAccount, getSpaceUsage } from "../../lib/dropbox-client.ts";

export default tool({
  id: "get-account",
  description: "Get current Dropbox account information including user details and storage usage.",
  inputSchema: z.object({
    includeSpaceUsage: z.boolean().default(true).describe(
      "Whether to include storage usage information",
    ),
  }),
  async execute({ includeSpaceUsage }) {
    const account = await getCurrentAccount();

    const result: Record<string, unknown> = {
      accountId: account.account_id,
      name: {
        displayName: account.name.display_name,
        givenName: account.name.given_name,
        surname: account.name.surname,
        familiarName: account.name.familiar_name,
      },
      email: account.email,
      emailVerified: account.email_verified,
      accountType: account.account_type[".tag"],
      country: account.country,
      locale: account.locale,
      disabled: account.disabled,
    };

    if (includeSpaceUsage) {
      try {
        const spaceUsage = await getSpaceUsage();

        const used = spaceUsage.used;
        const allocated = spaceUsage.allocation.allocated;

        result.storage = {
          used,
          usedFormatted: formatFileSize(used),
          allocated: allocated || 0,
          allocatedFormatted: allocated ? formatFileSize(allocated) : "N/A",
          allocationType: spaceUsage.allocation[".tag"],
          percentUsed: allocated ? Math.round((used / allocated) * 100) : 0,
          available: allocated ? allocated - used : 0,
          availableFormatted: allocated ? formatFileSize(allocated - used) : "N/A",
        };
      } catch (error) {
        result.storageError = error instanceof Error
          ? error.message
          : "Failed to get storage usage";
      }
    }

    return result;
  },
});
