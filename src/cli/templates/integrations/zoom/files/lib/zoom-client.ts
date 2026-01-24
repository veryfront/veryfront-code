import { getAccessToken } from "./token-store.ts";

const ZOOM_BASE_URL = "https://api.zoom.us/v2";

interface ZoomMeeting {
  id: number;
  uuid: string;
  topic: string;
  type: number;
  start_time: string;
  duration: number;
  timezone: string;
  agenda: string;
  created_at: string;
  join_url: string;
  password?: string;
  host_id: string;
  host_email: string;
  status: string;
  settings?: {
    host_video: boolean;
    participant_video: boolean;
    join_before_host: boolean;
    mute_upon_entry: boolean;
    watermark: boolean;
    audio: string;
    auto_recording: string;
  };
}

interface ZoomUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  type: number;
  pmi: number;
  timezone: string;
  verified: number;
  created_at: string;
  last_login_time: string;
  pic_url: string;
}

interface ZoomMeetingList {
  meetings: ZoomMeeting[];
  page_count: number;
  page_number: number;
  page_size: number;
  total_records: number;
}

interface MeetingSettingsInput {
  hostVideo?: boolean;
  participantVideo?: boolean;
  joinBeforeHost?: boolean;
  muteUponEntry?: boolean;
  watermark?: boolean;
  audio?: "both" | "telephony" | "voip";
  autoRecording?: "local" | "cloud" | "none";
}

function toZoomSettings(settings?: MeetingSettingsInput): Record<string, unknown> | undefined {
  if (!settings) return undefined;

  return {
    host_video: settings.hostVideo,
    participant_video: settings.participantVideo,
    join_before_host: settings.joinBeforeHost,
    mute_upon_entry: settings.muteUponEntry,
    watermark: settings.watermark,
    audio: settings.audio,
    auto_recording: settings.autoRecording,
  };
}

async function zoomFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Zoom. Please connect your account.");
  }

  const response = await fetch(`${ZOOM_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({} as { message?: string }));
    throw new Error(
      `Zoom API error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function getUser(): Promise<ZoomUser> {
  return zoomFetch<ZoomUser>("/users/me");
}

export async function listMeetings(
  options: {
    userId?: string;
    type?: "scheduled" | "live" | "upcoming" | "upcoming_meetings" | "previous_meetings";
    pageSize?: number;
    pageNumber?: number;
  } = {},
): Promise<ZoomMeeting[]> {
  const userId = options.userId ?? "me";
  const params = new URLSearchParams({
    type: options.type ?? "scheduled",
    page_size: String(options.pageSize ?? 30),
    page_number: String(options.pageNumber ?? 1),
  });

  const response = await zoomFetch<ZoomMeetingList>(`/users/${userId}/meetings?${params}`);
  return response.meetings;
}

export async function getMeeting(meetingId: string | number): Promise<ZoomMeeting> {
  return zoomFetch<ZoomMeeting>(`/meetings/${meetingId}`);
}

export async function createMeeting(options: {
  userId?: string;
  topic: string;
  type?: 1 | 2 | 3 | 8; // 1=Instant, 2=Scheduled, 3=Recurring with no fixed time, 8=Recurring with fixed time
  startTime?: string; // ISO 8601 format
  duration?: number; // In minutes
  timezone?: string;
  password?: string;
  agenda?: string;
  settings?: MeetingSettingsInput;
}): Promise<ZoomMeeting> {
  const userId = options.userId ?? "me";
  const body: Record<string, unknown> = {
    topic: options.topic,
    type: options.type ?? 2,
  };

  if (options.startTime) body.start_time = options.startTime;
  if (options.duration) body.duration = options.duration;
  if (options.timezone) body.timezone = options.timezone;
  if (options.password) body.password = options.password;
  if (options.agenda) body.agenda = options.agenda;

  const settings = toZoomSettings(options.settings);
  if (settings) body.settings = settings;

  return zoomFetch<ZoomMeeting>(`/users/${userId}/meetings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateMeeting(
  meetingId: string | number,
  updates: {
    topic?: string;
    type?: 1 | 2 | 3 | 8;
    startTime?: string;
    duration?: number;
    timezone?: string;
    password?: string;
    agenda?: string;
    settings?: MeetingSettingsInput;
  },
): Promise<void> {
  const body: Record<string, unknown> = {};

  if (updates.topic !== undefined) body.topic = updates.topic;
  if (updates.type !== undefined) body.type = updates.type;
  if (updates.startTime !== undefined) body.start_time = updates.startTime;
  if (updates.duration !== undefined) body.duration = updates.duration;
  if (updates.timezone !== undefined) body.timezone = updates.timezone;
  if (updates.password !== undefined) body.password = updates.password;
  if (updates.agenda !== undefined) body.agenda = updates.agenda;

  const settings = toZoomSettings(updates.settings);
  if (settings) body.settings = settings;

  await zoomFetch<void>(`/meetings/${meetingId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteMeeting(
  meetingId: string | number,
  options?: {
    occurrenceId?: string;
    scheduleForReminder?: boolean;
  },
): Promise<void> {
  const params = new URLSearchParams();
  if (options?.occurrenceId) params.set("occurrence_id", options.occurrenceId);
  if (options?.scheduleForReminder !== undefined) {
    params.set("schedule_for_reminder", String(options.scheduleForReminder));
  }

  const queryString = params.toString();
  await zoomFetch<void>(`/meetings/${meetingId}${queryString ? `?${queryString}` : ""}`, {
    method: "DELETE",
  });
}
