/**
 * Gmail API Client
 *
 * Provides a type-safe interface to Gmail API operations
 * using the veryfront/oauth module for authentication.
 */

import { gmailConfig, OAuthService } from "veryfront/oauth";
import { tokenStore } from "./token-store.ts";

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

// Adapter to bridge user's tokenStore with framework's TokenStore interface
const tokenStoreAdapter = {
  async getTokens(serviceId: string) {
    return tokenStore.getToken("current-user", serviceId);
  },
  async setTokens(serviceId: string, tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }) {
    await tokenStore.setToken("current-user", serviceId, tokens);
  },
  async clearTokens(serviceId: string) {
    await tokenStore.revokeToken("current-user", serviceId);
  },
  // State methods not needed for API client
  async getState() { return null; },
  async setState() {},
  async clearState() {},
};

// Create Gmail service using the user's token store
const gmailService = new OAuthService(gmailConfig, tokenStoreAdapter);

/**
 * Create a Gmail client for API operations
 */
export function createGmailClient() {
  // OAuthService.fetch() already handles auth, error checking, and JSON parsing
  async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return gmailService.fetch<T>(endpoint, options);
  }

  return {
    /**
     * Check if Gmail is connected
     */
    async isConnected(): Promise<boolean> {
      const token = await gmailService.getAccessToken();
      return token !== null;
    },

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
