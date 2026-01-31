import { tool } from "veryfront/tool";
import { z } from "zod";
import {
  formatFileSize,
  getCurrentAccount,
  getSpaceUsage,
} from "../../lib/dropbox-client.ts";

export default tool({
  id: "get-account",
  description:
    "Get current Dropbox account information including user details and storage usage.",
  inputSchema: z.object({
    includeSpaceUsage: z
      .boolean()
      .default(true)
      .describe("Whether to include storage usage information"),
  }),
  async execute({ includeSpaceUsage }): Promise<Record<string, unknown>> {
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

    if (!includeSpaceUsage) return result;

    try {
      const spaceUsage = await getSpaceUsage();
      const used = spaceUsage.used;
      const allocated = spaceUsage.allocation.allocated ?? 0;
      const hasAllocated = allocated > 0;

      result.storage = {
        used,
        usedFormatted: formatFileSize(used),
        allocated,
        allocatedFormatted: hasAllocated ? formatFileSize(allocated) : "N/A",
        allocationType: spaceUsage.allocation[".tag"],
        percentUsed: hasAllocated ? Math.round((used / allocated) * 100) : 0,
        available: hasAllocated ? allocated - used : 0,
        availableFormatted: hasAllocated
          ? formatFileSize(allocated - used)
          : "N/A",
      };
    } catch (error) {
      result.storageError =
        error instanceof Error ? error.message : "Failed to get storage usage";
    }

    return result;
  },
});
