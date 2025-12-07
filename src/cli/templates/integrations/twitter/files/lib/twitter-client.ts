/**
 * Twitter API Client
 *
 * Provides a type-safe interface to Twitter API v2 operations.
 */

import { tokenStore as _tokenStore } from "./token-store.ts";
import { getValidToken } from "./oauth.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  } // @ts-ignore - process global
  else if (typeof process !== "undefined" && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

const TWITTER_API_BASE = "https://api.twitter.com/2";

export interface TwitterUser {
  id: string;
  name: string;
  username: string;
  created_at?: string;
  description?: string;
  location?: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  verified?: boolean;
}

export interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
  referenced_tweets?: Array<{
    type: string;
    id: string;
  }>;
  entities?: {
    hashtags?: Array<{ tag: string }>;
    mentions?: Array<{ username: string; id: string }>;
    urls?: Array<{ url: string; expanded_url: string }>;
  };
}

export interface SearchResult {
  data: Tweet[];
  meta: {
    newest_id?: string;
    oldest_id?: string;
    result_count: number;
    next_token?: string;
  };
}

/**
 * Twitter OAuth provider configuration
 */
export const twitterOAuthProvider = {
  name: "twitter",
  authorizationUrl: "https://twitter.com/i/oauth2/authorize",
  tokenUrl: "https://api.twitter.com/2/oauth2/token",
  clientId: getEnv("TWITTER_CLIENT_ID") || "",
  clientSecret: getEnv("TWITTER_CLIENT_SECRET") || "",
  scopes: [
    "tweet.read",
    "tweet.write",
    "users.read",
    "follows.read",
    "offline.access",
  ],
  callbackPath: "/api/auth/twitter/callback",
  usePKCE: true,
};

/**
 * Create a Twitter client for a specific user
 */
export function createTwitterClient(userId: string) {
  const getAccessToken = async (): Promise<string> => {
    const token = await getValidToken(twitterOAuthProvider, userId, "twitter");
    if (!token) {
      throw new Error("Twitter not connected. Please connect your Twitter account first.");
    }
    return token;
  };

  const twitterFetch = async <T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> => {
    const accessToken = await getAccessToken();

    const response = await fetch(`${TWITTER_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Twitter API error: ${error.detail || error.title || response.statusText}`);
    }

    return response.json();
  };

  return {
    /**
     * Get authenticated user information
     */
    getMe: async (): Promise<TwitterUser> => {
      const result = await twitterFetch<{ data: TwitterUser }>(
        "/users/me?user.fields=created_at,description,location,profile_image_url,public_metrics,verified",
      );
      return result.data;
    },

    /**
     * Get user by ID
     */
    getUserById: async (userId: string): Promise<TwitterUser> => {
      const result = await twitterFetch<{ data: TwitterUser }>(
        `/users/${userId}?user.fields=created_at,description,location,profile_image_url,public_metrics,verified`,
      );
      return result.data;
    },

    /**
     * Get user's tweets
     */
    getTweets: async (
      userId: string,
      options: { maxResults?: number; excludeReplies?: boolean } = {},
    ): Promise<Tweet[]> => {
      const params = new URLSearchParams({
        "max_results": String(options.maxResults || 10),
        "tweet.fields": "created_at,public_metrics,referenced_tweets,entities",
      });

      if (options.excludeReplies) {
        params.set("exclude", "replies");
      }

      const result = await twitterFetch<{ data: Tweet[] }>(
        `/users/${userId}/tweets?${params.toString()}`,
      );
      return result.data || [];
    },

    /**
     * Get single tweet by ID
     */
    getTweet: async (tweetId: string): Promise<Tweet> => {
      const result = await twitterFetch<{ data: Tweet }>(
        `/tweets/${tweetId}?tweet.fields=created_at,public_metrics,referenced_tweets,entities,author_id`,
      );
      return result.data;
    },

    /**
     * Post a new tweet
     */
    postTweet: async (text: string): Promise<{ id: string; text: string }> => {
      const result = await twitterFetch<{ data: { id: string; text: string } }>(
        "/tweets",
        {
          method: "POST",
          body: JSON.stringify({ text }),
        },
      );
      return result.data;
    },

    /**
     * Search recent tweets
     */
    searchTweets: (
      query: string,
      options: { maxResults?: number; sortOrder?: "recency" | "relevancy" } = {},
    ): Promise<SearchResult> => {
      const params = new URLSearchParams({
        query,
        "max_results": String(options.maxResults || 10),
        "tweet.fields": "created_at,public_metrics,referenced_tweets,entities,author_id",
        "sort_order": options.sortOrder || "recency",
      });

      return twitterFetch<SearchResult>(
        `/tweets/search/recent?${params.toString()}`,
      );
    },

    /**
     * Get home timeline (reverse chronological tweets from followed accounts)
     */
    getTimeline: async (options: { maxResults?: number } = {}): Promise<Tweet[]> => {
      const me = await twitterFetch<{ data: TwitterUser }>("/users/me");
      const userId = me.data.id;

      const params = new URLSearchParams({
        "max_results": String(options.maxResults || 10),
        "tweet.fields": "created_at,public_metrics,referenced_tweets,entities,author_id",
      });

      const result = await twitterFetch<{ data: Tweet[] }>(
        `/users/${userId}/timelines/reverse_chronological?${params.toString()}`,
      );
      return result.data || [];
    },
  };
}

export type TwitterClient = ReturnType<typeof createTwitterClient>;
