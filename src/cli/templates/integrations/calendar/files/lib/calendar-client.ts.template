/**
 * Google Calendar API Client
 *
 * Provides a type-safe interface to Google Calendar API operations.
 */

import { getValidToken } from "./oauth.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  }
  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    responseStatus: "needsAction" | "declined" | "tentative" | "accepted";
    displayName?: string;
  }>;
  htmlLink: string;
  status: "confirmed" | "tentative" | "cancelled";
  organizer?: { email: string; displayName?: string };
}

export interface CreateEventOptions {
  summary: string;
  description?: string;
  location?: string;
  start: Date | string;
  end: Date | string;
  attendees?: string[];
  timeZone?: string;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

/**
 * Google Calendar OAuth provider configuration
 */
export const calendarOAuthProvider = {
  name: "calendar",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: getEnv("GOOGLE_CLIENT_ID") ?? "",
  clientSecret: getEnv("GOOGLE_CLIENT_SECRET") ?? "",
  scopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  callbackPath: "/api/auth/calendar/callback",
};

/**
 * Create a Calendar client for a specific user
 */
export function createCalendarClient(userId: string): {
  listEvents(options?: {
    maxResults?: number;
    timeMin?: Date | string;
    timeMax?: Date | string;
    calendarId?: string;
  }): Promise<CalendarEvent[]>;
  getTodayEvents(): Promise<CalendarEvent[]>;
  createEvent(options: CreateEventOptions, calendarId?: string): Promise<CalendarEvent>;
  getFreeBusy(options: {
    timeMin: Date | string;
    timeMax: Date | string;
    calendarId?: string;
  }): Promise<FreeBusySlot[]>;
  findFreeSlots(options: {
    timeMin: Date | string;
    timeMax: Date | string;
    durationMinutes: number;
    calendarId?: string;
  }): Promise<Array<{ start: Date; end: Date }>>;
  deleteEvent(eventId: string, calendarId?: string): Promise<void>;
} {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(calendarOAuthProvider, userId, "calendar");
    if (!token) {
      throw new Error("Calendar not connected. Please connect your Google Calendar first.");
    }
    return token;
  }

  async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${CALENDAR_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Calendar API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async function listEvents(options: {
    maxResults?: number;
    timeMin?: Date | string;
    timeMax?: Date | string;
    calendarId?: string;
  } = {}): Promise<CalendarEvent[]> {
    const params = new URLSearchParams();

    params.set(
      "timeMin",
      options.timeMin ? new Date(options.timeMin).toISOString() : new Date().toISOString(),
    );

    if (options.timeMax) {
      params.set("timeMax", new Date(options.timeMax).toISOString());
    }

    params.set("maxResults", String(options.maxResults ?? 10));
    params.set("singleEvents", "true");
    params.set("orderBy", "startTime");

    const calendarId = encodeURIComponent(options.calendarId ?? "primary");
    const result = await apiRequest<{ items: CalendarEvent[] }>(
      `/calendars/${calendarId}/events?${params.toString()}`,
    );

    return result.items ?? [];
  }

  function getTodayEvents(): Promise<CalendarEvent[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return listEvents({
      timeMin: today,
      timeMax: tomorrow,
      maxResults: 50,
    });
  }

  function createEvent(options: CreateEventOptions, calendarId = "primary"): Promise<CalendarEvent> {
    const startDate = typeof options.start === "string" ? options.start : options.start.toISOString();
    const endDate = typeof options.end === "string" ? options.end : options.end.toISOString();
    const timeZone = options.timeZone ?? "UTC";

    const event = {
      summary: options.summary,
      description: options.description,
      location: options.location,
      start: {
        dateTime: startDate,
        timeZone,
      },
      end: {
        dateTime: endDate,
        timeZone,
      },
      attendees: options.attendees?.map((email) => ({ email })),
    };

    return apiRequest<CalendarEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
  }

  async function getFreeBusy(options: {
    timeMin: Date | string;
    timeMax: Date | string;
    calendarId?: string;
  }): Promise<FreeBusySlot[]> {
    const calendarId = options.calendarId ?? "primary";

    const result = await apiRequest<{
      calendars: Record<string, { busy: FreeBusySlot[] }>;
    }>("/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: new Date(options.timeMin).toISOString(),
        timeMax: new Date(options.timeMax).toISOString(),
        items: [{ id: calendarId }],
      }),
    });

    return result.calendars[calendarId]?.busy ?? [];
  }

  async function findFreeSlots(options: {
    timeMin: Date | string;
    timeMax: Date | string;
    durationMinutes: number;
    calendarId?: string;
  }): Promise<Array<{ start: Date; end: Date }>> {
    const busySlots = await getFreeBusy({
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      calendarId: options.calendarId,
    });

    const freeSlots: Array<{ start: Date; end: Date }> = [];
    const rangeStart = new Date(options.timeMin);
    const rangeEnd = new Date(options.timeMax);
    const durationMs = options.durationMinutes * 60 * 1000;

    let currentStart = rangeStart;

    const sortedBusy = busySlots
      .map((s) => ({ start: new Date(s.start), end: new Date(s.end) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (const busy of sortedBusy) {
      if (busy.start.getTime() - currentStart.getTime() >= durationMs) {
        freeSlots.push({ start: new Date(currentStart), end: new Date(busy.start) });
      }
      if (busy.end > currentStart) {
        currentStart = busy.end;
      }
    }

    if (rangeEnd.getTime() - currentStart.getTime() >= durationMs) {
      freeSlots.push({ start: new Date(currentStart), end: rangeEnd });
    }

    return freeSlots;
  }

  async function deleteEvent(eventId: string, calendarId = "primary"): Promise<void> {
    const accessToken = await getAccessToken();

    const response = await fetch(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to delete event: ${response.status}`);
    }
  }

  return {
    listEvents,
    getTodayEvents,
    createEvent,
    getFreeBusy,
    findFreeSlots,
    deleteEvent,
  };
}

export type CalendarClient = ReturnType<typeof createCalendarClient>;
