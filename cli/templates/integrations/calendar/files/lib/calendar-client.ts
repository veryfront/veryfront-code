/**
 * Google Calendar API Client
 *
 * Provides a type-safe interface to Google Calendar API operations.
 */

import { fetchOAuthJson } from "./oauth.ts";

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

export interface UpdateEventOptions {
  summary?: string;
  description?: string;
  location?: string;
  start?: Date | string;
  end?: Date | string;
  attendees?: string[];
  timeZone?: string;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

type ListEventsOptions = {
  maxResults?: number;
  timeMin?: Date | string;
  timeMax?: Date | string;
  calendarId?: string;
};

type FreeBusyOptions = {
  timeMin: Date | string;
  timeMax: Date | string;
  calendarId?: string;
};

type FindFreeSlotsOptions = FreeBusyOptions & {
  durationMinutes: number;
};

type CalendarClientShape = {
  listEvents(options?: ListEventsOptions): Promise<CalendarEvent[]>;
  getTodayEvents(): Promise<CalendarEvent[]>;
  createEvent(
    options: CreateEventOptions,
    calendarId?: string,
  ): Promise<CalendarEvent>;
  updateEvent(
    eventId: string,
    options: UpdateEventOptions,
    calendarId?: string,
  ): Promise<CalendarEvent>;
  getFreeBusy(options: FreeBusyOptions): Promise<FreeBusySlot[]>;
  findFreeSlots(
    options: FindFreeSlotsOptions,
  ): Promise<Array<{ start: Date; end: Date }>>;
  deleteEvent(eventId: string, calendarId?: string): Promise<void>;
};

/**
 * Create a Calendar client for a specific user
 */
export function createCalendarClient(userId: string): CalendarClientShape {
  function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return fetchOAuthJson<T>(
      userId,
      "calendar",
      `${CALENDAR_API_BASE}${endpoint}`,
      {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      },
    );
  }

  async function listEvents(
    options: ListEventsOptions = {},
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams();

    const timeMin = options.timeMin ? new Date(options.timeMin) : new Date();
    params.set("timeMin", timeMin.toISOString());

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

    return listEvents({ timeMin: today, timeMax: tomorrow, maxResults: 50 });
  }

  function createEvent(
    options: CreateEventOptions,
    calendarId = "primary",
  ): Promise<CalendarEvent> {
    const startDate = typeof options.start === "string"
      ? options.start
      : options.start.toISOString();
    const endDate = typeof options.end === "string"
      ? options.end
      : options.end.toISOString();
    const timeZone = options.timeZone ?? "UTC";

    const event = {
      summary: options.summary,
      description: options.description,
      location: options.location,
      start: { dateTime: startDate, timeZone },
      end: { dateTime: endDate, timeZone },
      attendees: options.attendees?.map((email) => ({ email })),
    };

    return apiRequest<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        body: JSON.stringify(event),
      },
    );
  }

  function updateEvent(
    eventId: string,
    options: UpdateEventOptions,
    calendarId = "primary",
  ): Promise<CalendarEvent> {
    const timeZone = options.timeZone ?? "UTC";
    const event: Record<string, unknown> = {};

    if (options.summary !== undefined) event.summary = options.summary;
    if (options.description !== undefined) {
      event.description = options.description;
    }
    if (options.location !== undefined) event.location = options.location;
    if (options.start !== undefined) {
      const startDate = typeof options.start === "string"
        ? options.start
        : options.start.toISOString();
      event.start = { dateTime: startDate, timeZone };
    }
    if (options.end !== undefined) {
      const endDate = typeof options.end === "string"
        ? options.end
        : options.end.toISOString();
      event.end = { dateTime: endDate, timeZone };
    }
    if (options.attendees !== undefined) {
      event.attendees = options.attendees.map((email) => ({ email }));
    }

    return apiRequest<CalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${
        encodeURIComponent(eventId)
      }?sendUpdates=none`,
      {
        method: "PATCH",
        body: JSON.stringify(event),
      },
    );
  }

  async function getFreeBusy(
    options: FreeBusyOptions,
  ): Promise<FreeBusySlot[]> {
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

  async function findFreeSlots(
    options: FindFreeSlotsOptions,
  ): Promise<Array<{ start: Date; end: Date }>> {
    const busySlots = await getFreeBusy(options);

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
        freeSlots.push({
          start: new Date(currentStart),
          end: new Date(busy.start),
        });
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

  async function deleteEvent(
    eventId: string,
    calendarId = "primary",
  ): Promise<void> {
    await fetchOAuthJson<void>(
      userId,
      "calendar",
      `${CALENDAR_API_BASE}/calendars/${
        encodeURIComponent(calendarId)
      }/events/${eventId}`,
      {
        method: "DELETE",
      },
    );
  }

  return {
    listEvents,
    getTodayEvents,
    createEvent,
    updateEvent,
    getFreeBusy,
    findFreeSlots,
    deleteEvent,
  };
}

export type CalendarClient = ReturnType<typeof createCalendarClient>;
