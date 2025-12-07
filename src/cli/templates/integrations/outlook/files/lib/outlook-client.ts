import { getAccessToken } from "./token-store.ts";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

interface GraphResponse<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export interface OutlookMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: {
    contentType: "text" | "html";
    content: string;
  };
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  ccRecipients?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  receivedDateTime: string;
  sentDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: "low" | "normal" | "high";
  conversationId: string;
  webLink: string;
}

export interface OutlookFolder {
  id: string;
  displayName: string;
  parentFolderId: string;
  childFolderCount: number;
  unreadItemCount: number;
  totalItemCount: number;
}

export interface SendEmailOptions {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  importance?: "low" | "normal" | "high";
  bodyType?: "text" | "html";
}

async function graphFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Microsoft. Please connect your account.");
  }

  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
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
      `Microsoft Graph API error: ${response.status} ${
        error.error?.message || response.statusText
      }`,
    );
  }

  return response.json();
}

export async function listEmails(options?: {
  folderId?: string;
  top?: number;
  skip?: number;
  filter?: string;
  orderBy?: string;
}): Promise<OutlookMessage[]> {
  const params = new URLSearchParams();

  if (options?.top) params.set("$top", options.top.toString());
  if (options?.skip) params.set("$skip", options.skip.toString());
  if (options?.filter) params.set("$filter", options.filter);
  if (options?.orderBy) params.set("$orderby", options.orderBy);

  const folderPath = options?.folderId ? `/mailFolders/${options.folderId}/messages` : "/messages";

  const queryString = params.toString();
  const endpoint = `${folderPath}${queryString ? `?${queryString}` : ""}`;

  const response = await graphFetch<GraphResponse<OutlookMessage>>(endpoint);
  return response.value || [];
}

export async function getEmail(messageId: string): Promise<OutlookMessage> {
  return graphFetch<OutlookMessage>(`/messages/${messageId}`);
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const message = {
    subject: options.subject,
    body: {
      contentType: options.bodyType || "text",
      content: options.body,
    },
    toRecipients: options.to.map((email) => ({
      emailAddress: { address: email },
    })),
    ccRecipients: options.cc?.map((email) => ({
      emailAddress: { address: email },
    })),
    bccRecipients: options.bcc?.map((email) => ({
      emailAddress: { address: email },
    })),
    importance: options.importance || "normal",
  };

  await graphFetch("/sendMail", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function searchEmails(options: {
  query: string;
  top?: number;
  skip?: number;
}): Promise<OutlookMessage[]> {
  const params = new URLSearchParams();
  params.set("$search", `"${options.query}"`);

  if (options.top) params.set("$top", options.top.toString());
  if (options.skip) params.set("$skip", options.skip.toString());

  const response = await graphFetch<GraphResponse<OutlookMessage>>(
    `/messages?${params.toString()}`,
  );
  return response.value || [];
}

export async function listFolders(): Promise<OutlookFolder[]> {
  const response = await graphFetch<GraphResponse<OutlookFolder>>("/mailFolders");
  return response.value || [];
}

export async function markAsRead(messageId: string): Promise<void> {
  await graphFetch(`/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead: true }),
  });
}

export async function markAsUnread(messageId: string): Promise<void> {
  await graphFetch(`/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead: false }),
  });
}

export async function deleteEmail(messageId: string): Promise<void> {
  await graphFetch(`/messages/${messageId}`, {
    method: "DELETE",
  });
}

export async function moveEmail(messageId: string, destinationFolderId: string): Promise<void> {
  await graphFetch(`/messages/${messageId}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId: destinationFolderId }),
  });
}

// Helper to format email for display
export function formatEmail(message: OutlookMessage): string {
  return `From: ${message.from.emailAddress.name || message.from.emailAddress.address}
To: ${message.toRecipients.map((r) => r.emailAddress.address).join(", ")}
Subject: ${message.subject}
Date: ${new Date(message.receivedDateTime).toLocaleString()}
Read: ${message.isRead ? "Yes" : "No"}

${message.bodyPreview}`;
}
