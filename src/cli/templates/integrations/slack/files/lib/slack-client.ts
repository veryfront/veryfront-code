
import { tokenStore as _tokenStore } from "./token-store.ts";
import { getValidToken } from "./oauth.ts";

function getEnv(key: string): string | undefined {
  if (typeof Deno !== "undefined") {
    return Deno.env.get(key);
  }
  else if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

const SLACK_API_BASE = "https://slack.com/api";

export interface SlackChannel {
  id: string;
  name: string;
  is_channel: boolean;
  is_private: boolean;
  is_member: boolean;
  topic?: { value: string };
  purpose?: { value: string };
}

export interface SlackMessage {
  type: string;
  user?: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number }>;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  profile: {
    display_name: string;
    email?: string;
    image_48?: string;
  };
}

export const slackOAuthProvider = {
  name: "slack",
  authorizationUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  clientId: getEnv("SLACK_CLIENT_ID") || "",
  clientSecret: getEnv("SLACK_CLIENT_SECRET") || "",
  scopes: [
    "channels:history",
    "channels:read",
    "chat:write",
    "users:read",
    "im:history",
    "im:read",
  ],
  callbackPath: "/api/auth/slack/callback",
};

export function createSlackClient(userId: string) {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(slackOAuthProvider, userId, "slack");
    if (!token) {
      throw new Error("Slack not connected. Please connect your Slack account first.");
    }
    return token;
  }

  async function apiRequest<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data as T;
  }

  return {
    async listChannels(options: {
      limit?: number;
      excludeArchived?: boolean;
    } = {}): Promise<SlackChannel[]> {
      const result = await apiRequest<{ channels: SlackChannel[] }>(
        "conversations.list",
        {
          limit: options.limit || 100,
          exclude_archived: options.excludeArchived ?? true,
          types: "public_channel,private_channel",
        },
      );
      return result.channels;
    },

    async getMessages(
      channelId: string,
      options: { limit?: number; oldest?: string } = {},
    ): Promise<SlackMessage[]> {
      const result = await apiRequest<{ messages: SlackMessage[] }>(
        "conversations.history",
        {
          channel: channelId,
          limit: options.limit || 20,
          oldest: options.oldest,
        },
      );
      return result.messages;
    },

    async sendMessage(
      channelId: string,
      text: string,
      options: { threadTs?: string; unfurlLinks?: boolean } = {},
    ): Promise<{ ts: string; channel: string }> {
      const result = await apiRequest<{ ts: string; channel: string }>(
        "chat.postMessage",
        {
          channel: channelId,
          text,
          thread_ts: options.threadTs,
          unfurl_links: options.unfurlLinks ?? true,
        },
      );
      return result;
    },

    async getUser(userId: string): Promise<SlackUser> {
      const result = await apiRequest<{ user: SlackUser }>("users.info", {
        user: userId,
      });
      return result.user;
    },

    async getThread(
      channelId: string,
      threadTs: string,
    ): Promise<SlackMessage[]> {
      const result = await apiRequest<{ messages: SlackMessage[] }>(
        "conversations.replies",
        {
          channel: channelId,
          ts: threadTs,
        },
      );
      return result.messages;
    },

    async searchMessages(
      query: string,
      options: { count?: number } = {},
    ): Promise<SlackMessage[]> {
      const result = await apiRequest<{
        messages: { matches: SlackMessage[] };
      }>("search.messages", {
        query,
        count: options.count || 20,
      });
      return result.messages.matches;
    },
  };
}

export type SlackClient = ReturnType<typeof createSlackClient>;
