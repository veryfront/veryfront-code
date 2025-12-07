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

async function discordFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Discord. Please connect your account.");
  }

  const response = await fetch(`${DISCORD_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Discord API error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function getCurrentUser(): Promise<DiscordUser> {
  return discordFetch<DiscordUser>("/users/@me");
}

export async function listGuilds(): Promise<DiscordGuild[]> {
  return discordFetch<DiscordGuild[]>("/users/@me/guilds");
}

export async function getGuild(guildId: string): Promise<DiscordGuild> {
  return discordFetch<DiscordGuild>(`/guilds/${guildId}`);
}

export async function listChannels(guildId: string): Promise<DiscordChannel[]> {
  return discordFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`);
}

export async function getChannel(channelId: string): Promise<DiscordChannel> {
  return discordFetch<DiscordChannel>(`/channels/${channelId}`);
}

export async function getMessages(
  channelId: string,
  options?: {
    limit?: number;
    before?: string;
    after?: string;
    around?: string;
  },
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams();

  if (options?.limit) {
    params.set("limit", Math.min(options.limit, 100).toString());
  }
  if (options?.before) {
    params.set("before", options.before);
  }
  if (options?.after) {
    params.set("after", options.after);
  }
  if (options?.around) {
    params.set("around", options.around);
  }

  const query = params.toString();
  const endpoint = `/channels/${channelId}/messages${query ? `?${query}` : ""}`;

  return discordFetch<DiscordMessage[]>(endpoint);
}

export async function sendMessage(
  channelId: string,
  content: string,
  options?: {
    tts?: boolean;
    embeds?: unknown[];
  },
): Promise<DiscordMessage> {
  const body: Record<string, unknown> = { content };

  if (options?.tts !== undefined) {
    body.tts = options.tts;
  }
  if (options?.embeds) {
    body.embeds = options.embeds;
  }

  return discordFetch<DiscordMessage>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getGuildMembers(
  guildId: string,
  options?: {
    limit?: number;
    after?: string;
  },
): Promise<DiscordGuildMember[]> {
  const params = new URLSearchParams();

  if (options?.limit) {
    params.set("limit", Math.min(options.limit, 1000).toString());
  }
  if (options?.after) {
    params.set("after", options.after);
  }

  const query = params.toString();
  const endpoint = `/guilds/${guildId}/members${query ? `?${query}` : ""}`;

  return discordFetch<DiscordGuildMember[]>(endpoint);
}

// Helper to format username with discriminator
export function formatUsername(user: DiscordUser): string {
  if (user.discriminator === "0") {
    // New username system without discriminator
    return user.username;
  }
  return `${user.username}#${user.discriminator}`;
}

// Helper to get user avatar URL
export function getAvatarUrl(user: DiscordUser, size: number = 128): string | null {
  if (!user.avatar) return null;

  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
}

// Helper to get guild icon URL
export function getGuildIconUrl(guild: DiscordGuild, size: number = 128): string | null {
  if (!guild.icon) return null;

  const extension = guild.icon.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${extension}?size=${size}`;
}

// Helper to get channel type name
export function getChannelTypeName(type: number): string {
  const types: Record<number, string> = {
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
  return types[type] || "Unknown";
}
