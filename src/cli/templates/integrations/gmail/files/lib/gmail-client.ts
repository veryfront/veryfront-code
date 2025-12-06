/**
 * Gmail API Client
 *
 * Provides a type-safe interface to Gmail API operations.
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

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string; size: number };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string; size: number };
    }>;
  };
  internalDate: string;
}

export interface GmailMessageList {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  isHtml?: boolean;
}

/**
 * Gmail OAuth provider configuration
 */
export const gmailOAuthProvider = {
  name: "gmail",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: getEnv("GOOGLE_CLIENT_ID") || "",
  clientSecret: getEnv("GOOGLE_CLIENT_SECRET") || "",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  callbackPath: "/api/auth/gmail/callback",
};

/**
 * Create a Gmail client for a specific user
 */
export function createGmailClient(userId: string) {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(gmailOAuthProvider, userId, "gmail");
    if (!token) {
      throw new Error("Gmail not connected. Please connect your Gmail account first.");
    }
    return token;
  }

  async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gmail API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  return {
    /**
     * List messages from the user's mailbox
     */
    listMessages(options: {
      maxResults?: number;
      query?: string;
      labelIds?: string[];
      pageToken?: string;
    } = {}): Promise<GmailMessageList> {
      const params = new URLSearchParams();
      if (options.maxResults) params.set("maxResults", String(options.maxResults));
      if (options.query) params.set("q", options.query);
      if (options.labelIds) params.set("labelIds", options.labelIds.join(","));
      if (options.pageToken) params.set("pageToken", options.pageToken);

      const query = params.toString();
      return apiRequest<GmailMessageList>(
        `/users/me/messages${query ? `?${query}` : ""}`,
      );
    },

    /**
     * Get a specific message by ID
     */
    getMessage(
      messageId: string,
      format: "full" | "metadata" | "minimal" = "full",
    ): Promise<GmailMessage> {
      return apiRequest<GmailMessage>(
        `/users/me/messages/${messageId}?format=${format}`,
      );
    },

    /**
     * Send an email
     */
    sendEmail(options: SendEmailOptions): Promise<{ id: string; threadId: string }> {
      const toAddresses = Array.isArray(options.to) ? options.to.join(", ") : options.to;
      const ccAddresses = options.cc
        ? Array.isArray(options.cc) ? options.cc.join(", ") : options.cc
        : "";
      const bccAddresses = options.bcc
        ? Array.isArray(options.bcc) ? options.bcc.join(", ") : options.bcc
        : "";

      const headers = [
        `To: ${toAddresses}`,
        `Subject: ${options.subject}`,
        options.isHtml
          ? "Content-Type: text/html; charset=utf-8"
          : "Content-Type: text/plain; charset=utf-8",
      ];

      if (ccAddresses) headers.push(`Cc: ${ccAddresses}`);
      if (bccAddresses) headers.push(`Bcc: ${bccAddresses}`);
      if (options.replyTo) headers.push(`Reply-To: ${options.replyTo}`);

      const email = `${headers.join("\r\n")}\r\n\r\n${options.body}`;

      // Encode email as base64url
      const encodedEmail = btoa(email)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      return apiRequest<{ id: string; threadId: string }>("/users/me/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: encodedEmail }),
      });
    },

    /**
     * Search emails by query
     */
    async searchEmails(query: string, maxResults = 10): Promise<GmailMessage[]> {
      const list = await this.listMessages({ query, maxResults });

      if (!list.messages || list.messages.length === 0) {
        return [];
      }

      // Fetch full message details
      const messages = await Promise.all(
        list.messages.map((m) => this.getMessage(m.id, "metadata")),
      );

      return messages;
    },

    /**
     * Get unread emails
     */
    getUnreadEmails(maxResults = 10): Promise<GmailMessage[]> {
      return this.searchEmails("is:unread", maxResults);
    },

    /**
     * Mark email as read
     */
    async markAsRead(messageId: string): Promise<void> {
      await apiRequest(`/users/me/messages/${messageId}/modify`, {
        method: "POST",
        body: JSON.stringify({
          removeLabelIds: ["UNREAD"],
        }),
      });
    },

    /**
     * Archive an email
     */
    async archiveEmail(messageId: string): Promise<void> {
      await apiRequest(`/users/me/messages/${messageId}/modify`, {
        method: "POST",
        body: JSON.stringify({
          removeLabelIds: ["INBOX"],
        }),
      });
    },
  };
}

/**
 * Parse email headers to extract common fields
 */
export function parseEmailHeaders(
  headers: Array<{ name: string; value: string }>,
): {
  from: string;
  to: string;
  subject: string;
  date: string;
} {
  const getHeader = (name: string): string => {
    const header = headers.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    );
    return header?.value || "";
  };

  return {
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
  };
}

export type GmailClient = ReturnType<typeof createGmailClient>;
