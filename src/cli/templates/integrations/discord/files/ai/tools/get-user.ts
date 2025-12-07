import { tool } from "veryfront/ai";
import { z } from "zod";
import { formatUsername, getAvatarUrl, getCurrentUser } from "../../lib/discord-client.ts";

export default tool({
  id: "get-user",
  description:
    "Get information about the authenticated Discord user. Returns username, ID, avatar, and account details.",
  inputSchema: z.object({
    includeAvatar: z.boolean().default(true).describe("Whether to include the avatar URL"),
  }),
  async execute({ includeAvatar }) {
    const user = await getCurrentUser();

    return {
      id: user.id,
      username: formatUsername(user),
      globalName: user.global_name,
      avatar: includeAvatar ? getAvatarUrl(user) : undefined,
      bot: user.bot,
      system: user.system,
      mfaEnabled: user.mfa_enabled,
      banner: user.banner,
      accentColor: user.accent_color,
      locale: user.locale,
      verified: user.verified,
      email: user.email,
      premiumType: user.premium_type,
      publicFlags: user.public_flags,
    };
  },
});
