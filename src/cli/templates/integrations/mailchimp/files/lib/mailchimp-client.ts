import { getAccessToken } from "./token-store.ts";

let MAILCHIMP_BASE_URL = "https://us1.api.mailchimp.com/3.0";

interface MailchimpResponse<T> {
  [key: string]: unknown;
}

interface MailchimpCampaign {
  id: string;
  web_id: number;
  type: string;
  create_time: string;
  archive_url: string;
  long_archive_url: string;
  status: string;
  emails_sent: number;
  send_time?: string;
  content_type: string;
  needs_block_refresh: boolean;
  recipients: {
    list_id: string;
    list_name: string;
    segment_text?: string;
  };
  settings: {
    subject_line: string;
    preview_text?: string;
    title: string;
    from_name: string;
    reply_to: string;
  };
  tracking: {
    opens: boolean;
    html_clicks: boolean;
    text_clicks: boolean;
  };
  report_summary?: {
    opens: number;
    unique_opens: number;
    open_rate: number;
    clicks: number;
    subscriber_clicks: number;
    click_rate: number;
  };
}

interface MailchimpList {
  id: string;
  web_id: number;
  name: string;
  contact: {
    company: string;
    address1: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  permission_reminder: string;
  campaign_defaults: {
    from_name: string;
    from_email: string;
    subject: string;
    language: string;
  };
  stats: {
    member_count: number;
    total_contacts: number;
    unsubscribe_count: number;
    cleaned_count: number;
    member_count_since_send: number;
    unsubscribe_count_since_send: number;
    cleaned_count_since_send: number;
    campaign_count: number;
    open_rate: number;
    click_rate: number;
  };
  date_created: string;
  list_rating: number;
  subscribe_url_short: string;
  subscribe_url_long: string;
}

interface MailchimpMember {
  id: string;
  email_address: string;
  unique_email_id: string;
  contact_id: string;
  full_name: string;
  web_id: number;
  email_type: string;
  status: "subscribed" | "unsubscribed" | "cleaned" | "pending" | "transactional";
  merge_fields: Record<string, unknown>;
  stats: {
    avg_open_rate: number;
    avg_click_rate: number;
  };
  ip_signup?: string;
  timestamp_signup?: string;
  ip_opt?: string;
  timestamp_opt?: string;
  member_rating: number;
  last_changed: string;
  language: string;
  vip: boolean;
  email_client?: string;
  location?: {
    latitude: number;
    longitude: number;
    gmtoff: number;
    dstoff: number;
    country_code: string;
    timezone: string;
  };
  tags: Array<{ id: number; name: string }>;
}

interface MailchimpMetadata {
  dc: string;
  role: string;
  accountname: string;
  user_id: string;
  login: {
    email: string;
    avatar?: string;
    login_id: string;
    login_name: string;
    login_email: string;
  };
}

async function initializeBaseUrl() {
  const token = await getAccessToken();
  if (!token) return;

  try {
    const response = await fetch("https://login.mailchimp.com/oauth2/metadata", {
      headers: {
        Authorization: `OAuth ${token}`,
      },
    });

    if (response.ok) {
      const metadata = (await response.json()) as MailchimpMetadata;
      MAILCHIMP_BASE_URL = `https://${metadata.dc}.api.mailchimp.com/3.0`;
    }
  } catch (error) {
    console.error("Failed to fetch Mailchimp metadata:", error);
  }
}

async function mailchimpFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Mailchimp. Please connect your account.");
  }

  if (MAILCHIMP_BASE_URL === "https://us1.api.mailchimp.com/3.0") {
    await initializeBaseUrl();
  }

  const response = await fetch(`${MAILCHIMP_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Mailchimp API error: ${response.status} ${(error as { detail?: string }).detail || response.statusText}`,
    );
  }

  return response.json();
}

export async function listCampaigns(options?: {
  status?: "save" | "paused" | "schedule" | "sending" | "sent";
  count?: number;
  offset?: number;
}): Promise<MailchimpCampaign[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.count) params.set("count", options.count.toString());
  if (options?.offset) params.set("offset", options.offset.toString());

  const queryString = params.toString();
  const response = await mailchimpFetch<{ campaigns: MailchimpCampaign[] }>(
    `/campaigns${queryString ? `?${queryString}` : ""}`,
  );
  return response.campaigns;
}

export async function getCampaign(campaignId: string): Promise<MailchimpCampaign> {
  return mailchimpFetch<MailchimpCampaign>(`/campaigns/${campaignId}`);
}

export async function listLists(options?: {
  count?: number;
  offset?: number;
}): Promise<MailchimpList[]> {
  const params = new URLSearchParams();
  if (options?.count) params.set("count", options.count.toString());
  if (options?.offset) params.set("offset", options.offset.toString());

  const queryString = params.toString();
  const response = await mailchimpFetch<{ lists: MailchimpList[] }>(
    `/lists${queryString ? `?${queryString}` : ""}`,
  );
  return response.lists;
}

export async function getList(listId: string): Promise<MailchimpList> {
  return mailchimpFetch<MailchimpList>(`/lists/${listId}`);
}

export async function listMembers(
  listId: string,
  options?: {
    status?: "subscribed" | "unsubscribed" | "cleaned" | "pending" | "transactional";
    count?: number;
    offset?: number;
  },
): Promise<MailchimpMember[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.count) params.set("count", options.count.toString());
  if (options?.offset) params.set("offset", options.offset.toString());

  const queryString = params.toString();
  const response = await mailchimpFetch<{ members: MailchimpMember[] }>(
    `/lists/${listId}/members${queryString ? `?${queryString}` : ""}`,
  );
  return response.members;
}

export async function getMetadata(): Promise<MailchimpMetadata> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Mailchimp. Please connect your account.");
  }

  const response = await fetch("https://login.mailchimp.com/oauth2/metadata", {
    headers: {
      Authorization: `OAuth ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Mailchimp metadata: ${response.statusText}`);
  }

  return response.json();
}
