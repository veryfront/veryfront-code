import { getAccessToken } from "./token-store.ts";

const DISCORD_API_VERSION = "v10";
const DISCORD_BASE_URL = `https://discord.com/api/${DISCORD_API_VERSION}`;

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  banner?: string | null;
  accent_color?: number | null;
  locale?: string;
  verified?: boolean;
  email?: string | null;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
  features: string[];
}

interface DiscordChannel {
  id: string;
  type: number;
  guild_id?: string;
  position?: number;
  name?: string;
  topic?: string | null;
  nsfw?: boolean;
  last_message_id?: string | null;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  recipients?: DiscordUser[];
  icon?: string | null;
  owner_id?: string;
  application_id?: string;
  parent_id?: string | null;
  last_pin_timestamp?: string | null;
  rtc_region?: string | null;
  video_quality_mode?: number;
  message_count?: number;
  member_count?: number;
  flags?: number;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: DiscordUser[];
  mention_roles: string[];
  attachments: Array<{
    id: string;
    filename: string;
    size: number;
    url: string;
    proxy_url: string;
    height?: number | null;
    width?: number | null;
    content_type?: string;
  }>;
  embeds: unknown[];
  reactions?: Array<{
    count: number;
    me: boolean;
    emoji: {
      id: string | null;
      name: string | null;
    };
  }>;
  pinned: boolean;
  type: number;
}

interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
  joined_at: string;
  premium_since?: string | null;
  deaf: boolean;
  mute: boolean;
  flags: number;
  pending?: boolean;
  permissions?: string;
  communication_disabled_until?: string | null;
}

async function discordFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Discord. Please connect your account.");
  }

  const response = await fetch(`${DISCORD_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Discord API error: ${response.status} ${error.message ?? response.statusText}`);
  }

  return response.json();
}

function buildQuery(
  options: Record<string, string | number | undefined>,
  limits?: Record<string, number>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;

    if (typeof value === "number") {
      const limit = limits?.[key];
      params.set(key, Math.min(value, limit ?? value).toString());
      continue;
    }

    params.set(key, value);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getCurrentUser(): Promise<DiscordUser> {
  return discordFetch("/users/@me");
}

export function listGuilds(): Promise<DiscordGuild[]> {
  return discordFetch("/users/@me/guilds");
}

export function getGuild(guildId: string): Promise<DiscordGuild> {
  return discordFetch(`/guilds/${guildId}`);
}

export function listChannels(guildId: string): Promise<DiscordChannel[]> {
  return discordFetch(`/guilds/${guildId}/channels`);
}

export function getChannel(channelId: string): Promise<DiscordChannel> {
  return discordFetch(`/channels/${channelId}`);
}

export function getMessages(
  channelId: string,
  options?: {
    limit?: number;
    before?: string;
    after?: string;
    around?: string;
  },
): Promise<DiscordMessage[]> {
  const query = buildQuery(
    {
      limit: options?.limit,
      before: options?.before,
      after: options?.after,
      around: options?.around,
    },
    { limit: 100 },
  );

  return discordFetch(`/channels/${channelId}/messages${query}`);
}

export function sendMessage(
  channelId: string,
  content: string,
  options?: {
    tts?: boolean;
    embeds?: unknown[];
  },
): Promise<DiscordMessage> {
  const body: Record<string, unknown> = { content };

  if (options?.tts !== undefined) body.tts = options.tts;
  if (options?.embeds) body.embeds = options.embeds;

  return discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getGuildMembers(
  guildId: string,
  options?: {
    limit?: number;
    after?: string;
  },
): Promise<DiscordGuildMember[]> {
  const query = buildQuery({ limit: options?.limit, after: options?.after }, { limit: 1000 });
  return discordFetch(`/guilds/${guildId}/members${query}`);
}

export function formatUsername(user: DiscordUser): string {
  if (user.discriminator === "0") return user.username;
  return `${user.username}#${user.discriminator}`;
}

function getCdnAssetUrl(
  basePath: string,
  id: string,
  hash: string | null | undefined,
  size: number,
): string | null {
  if (!hash) return null;
  const extension = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/${basePath}/${id}/${hash}.${extension}?size=${size}`;
}

export function getAvatarUrl(user: DiscordUser, size: number = 128): string | null {
  return getCdnAssetUrl("avatars", user.id, user.avatar, size);
}

export function getGuildIconUrl(guild: DiscordGuild, size: number = 128): string | null {
  return getCdnAssetUrl("icons", guild.id, guild.icon, size);
}

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: "Text",
  1: "DM",
  2: "Voice",
  3: "Group DM",
  4: "Category",
  5: "Announcement",
  10: "Announcement Thread",
  11: "Public Thread",
  12: "Private Thread",
  13: "Stage Voice",
  14: "Directory",
  15: "Forum",
};

export function getChannelTypeName(type: number): string {
  return CHANNEL_TYPE_NAMES[type] ?? "Unknown";
}
