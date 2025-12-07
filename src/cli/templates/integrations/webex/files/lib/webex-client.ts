import { getAccessToken } from "./token-store.ts";

const WEBEX_BASE_URL = "https://webexapis.com/v1";

interface WebexMeeting {
  id: string;
  title: string;
  agenda?: string;
  start: string;
  end: string;
  timezone: string;
  hostEmail: string;
  hostDisplayName: string;
  webLink: string;
  sipAddress?: string;
  meetingNumber?: string;
  state: string;
  enabledAutoRecordMeeting?: boolean;
  allowAnyUserToBeCoHost?: boolean;
}

interface WebexRoom {
  id: string;
  title: string;
  type: "direct" | "group";
  isLocked: boolean;
  lastActivity: string;
  creatorId: string;
  created: string;
}

interface WebexMessage {
  id: string;
  roomId: string;
  roomType: string;
  text?: string;
  markdown?: string;
  personId: string;
  personEmail: string;
  created: string;
}

interface WebexPerson {
  id: string;
  emails: string[];
  displayName: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  orgId: string;
  created: string;
  lastActivity?: string;
  status?: string;
  type: string;
}

async function webexFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Webex. Please connect your account.");
  }

  const response = await fetch(`${WEBEX_BASE_URL}${endpoint}`, {
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
      `Webex API error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function getMe(): Promise<WebexPerson> {
  return webexFetch<WebexPerson>("/people/me");
}

/**
 * List meetings for the authenticated user
 */
export async function listMeetings(options?: {
  max?: number;
  from?: string;
  to?: string;
  meetingType?: "meeting" | "webinar" | "personalRoomMeeting";
  state?: "active" | "scheduled" | "ended" | "missed" | "inProgress";
}): Promise<WebexMeeting[]> {
  const params = new URLSearchParams();

  if (options?.max) params.set("max", options.max.toString());
  if (options?.from) params.set("from", options.from);
  if (options?.to) params.set("to", options.to);
  if (options?.meetingType) params.set("meetingType", options.meetingType);
  if (options?.state) params.set("state", options.state);

  const response = await webexFetch<{ items: WebexMeeting[] }>(
    `/meetings?${params}`,
  );
  return response.items || [];
}

/**
 * Get details of a specific meeting
 */
export async function getMeeting(meetingId: string): Promise<WebexMeeting> {
  return webexFetch<WebexMeeting>(`/meetings/${meetingId}`);
}

/**
 * Create a new Webex meeting
 */
export async function createMeeting(options: {
  title: string;
  agenda?: string;
  start: string;
  end: string;
  timezone?: string;
  enabledAutoRecordMeeting?: boolean;
  allowAnyUserToBeCoHost?: boolean;
  invitees?: Array<{ email: string; displayName?: string; coHost?: boolean }>;
}): Promise<WebexMeeting> {
  const body: Record<string, unknown> = {
    title: options.title,
    start: options.start,
    end: options.end,
    timezone: options.timezone || "UTC",
  };

  if (options.agenda) body.agenda = options.agenda;
  if (options.enabledAutoRecordMeeting !== undefined) {
    body.enabledAutoRecordMeeting = options.enabledAutoRecordMeeting;
  }
  if (options.allowAnyUserToBeCoHost !== undefined) {
    body.allowAnyUserToBeCoHost = options.allowAnyUserToBeCoHost;
  }
  if (options.invitees && options.invitees.length > 0) {
    body.invitees = options.invitees;
  }

  return webexFetch<WebexMeeting>("/meetings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Update an existing meeting
 */
export async function updateMeeting(
  meetingId: string,
  updates: {
    title?: string;
    agenda?: string;
    start?: string;
    end?: string;
    timezone?: string;
    enabledAutoRecordMeeting?: boolean;
  },
): Promise<WebexMeeting> {
  return webexFetch<WebexMeeting>(`/meetings/${meetingId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

/**
 * Delete a meeting
 */
export async function deleteMeeting(meetingId: string): Promise<void> {
  await webexFetch<void>(`/meetings/${meetingId}`, {
    method: "DELETE",
  });
}

/**
 * List Webex rooms (spaces)
 */
export async function listRooms(options?: {
  max?: number;
  type?: "direct" | "group";
  sortBy?: "id" | "lastactivity" | "created";
}): Promise<WebexRoom[]> {
  const params = new URLSearchParams();

  if (options?.max) params.set("max", options.max.toString());
  if (options?.type) params.set("type", options.type);
  if (options?.sortBy) params.set("sortBy", options.sortBy);

  const response = await webexFetch<{ items: WebexRoom[] }>(
    `/rooms?${params}`,
  );
  return response.items || [];
}

/**
 * Get details of a specific room
 */
export async function getRoom(roomId: string): Promise<WebexRoom> {
  return webexFetch<WebexRoom>(`/rooms/${roomId}`);
}

/**
 * Create a new room
 */
export async function createRoom(options: {
  title: string;
  teamId?: string;
}): Promise<WebexRoom> {
  return webexFetch<WebexRoom>("/rooms", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

/**
 * Send a message to a Webex room
 */
export async function sendMessage(options: {
  roomId?: string;
  toPersonId?: string;
  toPersonEmail?: string;
  text?: string;
  markdown?: string;
  files?: string[];
}): Promise<WebexMessage> {
  if (!options.roomId && !options.toPersonId && !options.toPersonEmail) {
    throw new Error("Must specify roomId, toPersonId, or toPersonEmail");
  }

  if (!options.text && !options.markdown && !options.files) {
    throw new Error("Must specify text, markdown, or files");
  }

  return webexFetch<WebexMessage>("/messages", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

/**
 * List messages in a room
 */
export async function listMessages(options: {
  roomId: string;
  max?: number;
  before?: string;
  beforeMessage?: string;
}): Promise<WebexMessage[]> {
  const params = new URLSearchParams({ roomId: options.roomId });

  if (options.max) params.set("max", options.max.toString());
  if (options.before) params.set("before", options.before);
  if (options.beforeMessage) params.set("beforeMessage", options.beforeMessage);

  const response = await webexFetch<{ items: WebexMessage[] }>(
    `/messages?${params}`,
  );
  return response.items || [];
}

/**
 * Delete a message
 */
export async function deleteMessage(messageId: string): Promise<void> {
  await webexFetch<void>(`/messages/${messageId}`, {
    method: "DELETE",
  });
}
