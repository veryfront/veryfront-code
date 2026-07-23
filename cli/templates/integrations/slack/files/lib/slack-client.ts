/**
 * Slack API Client
 *
 * Provides a type-safe interface to Slack API operations.
 */

import { fetchOAuthJson } from "./oauth.ts";

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

export interface SlackClient {
  listChannels(options?: {
    limit?: number;
    excludeArchived?: boolean;
  }): Promise<SlackChannel[]>;
  getMessages(
    channelId: string,
    options?: { limit?: number; oldest?: string },
  ): Promise<SlackMessage[]>;
  sendMessage(
    channelId: string,
    text: string,
    options?: { threadTs?: string; unfurlLinks?: boolean },
  ): Promise<{ ts: string; channel: string }>;
  getUser(userId: string): Promise<SlackUser>;
  getThread(channelId: string, threadTs: string): Promise<SlackMessage[]>;
  searchMessages(
    query: string,
    options?: { count?: number },
  ): Promise<SlackMessage[]>;
}

/**
 * Create a Slack client for a specific user
 */
export function createSlackClient(userId: string): SlackClient {
  async function apiRequest<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const data = await fetchOAuthJson<{ ok?: boolean; error?: string } & T>(
      userId,
      "slack",
      `${SLACK_API_BASE}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(params),
      },
    );

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data;
  }

  return {
    /**
     * List channels the user is a member of
     */
    async listChannels(options = {}): Promise<SlackChannel[]> {
      const result = await apiRequest<{ channels: SlackChannel[] }>(
        "conversations.list",
        {
          limit: options.limit ?? 100,
          exclude_archived: options.excludeArchived ?? true,
          types: "public_channel,private_channel",
        },
      );
      return result.channels;
    },

    /**
     * Get messages from a channel
     */
    async getMessages(
      channelId: string,
      options = {},
    ): Promise<SlackMessage[]> {
      const result = await apiRequest<{ messages: SlackMessage[] }>(
        "conversations.history",
        {
          channel: channelId,
          limit: options.limit ?? 20,
          oldest: options.oldest,
        },
      );
      return result.messages;
    },

    /**
     * Send a message to a channel
     */
    sendMessage(
      channelId: string,
      text: string,
      options = {},
    ): Promise<{ ts: string; channel: string }> {
      return apiRequest<{ ts: string; channel: string }>("chat.postMessage", {
        channel: channelId,
        text,
        thread_ts: options.threadTs,
        unfurl_links: options.unfurlLinks ?? true,
      });
    },

    /**
     * Get user info
     */
    async getUser(userId: string): Promise<SlackUser> {
      const result = await apiRequest<{ user: SlackUser }>("users.info", {
        user: userId,
      });
      return result.user;
    },

    /**
     * Get thread replies
     */
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

    /**
     * Search messages
     */
    async searchMessages(
      query: string,
      options = {},
    ): Promise<SlackMessage[]> {
      const result = await apiRequest<{
        messages: { matches: SlackMessage[] };
      }>("search.messages", {
        query,
        count: options.count ?? 20,
      });
      return result.messages.matches;
    },
  };
}
