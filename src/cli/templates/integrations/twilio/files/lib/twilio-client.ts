/**
 * Twilio API Client
 *
 * Provides a type-safe interface to Twilio API operations for SMS, WhatsApp, and voice calls.
 * Documentation: https://www.twilio.com/docs/api
 */

import { getTwilioCredentials } from "./token-store.ts";

const TWILIO_API_VERSION = "2010-04-01";

// Types
export interface TwilioMessage {
  sid: string;
  account_sid: string;
  from: string;
  to: string;
  body: string;
  status: "queued" | "sending" | "sent" | "failed" | "delivered" | "undelivered" | "receiving" | "received";
  direction: "inbound" | "outbound-api" | "outbound-call" | "outbound-reply";
  date_created: string;
  date_updated: string;
  date_sent: string | null;
  price: string | null;
  price_unit: string | null;
  error_code: number | null;
  error_message: string | null;
  uri: string;
  num_segments: string;
  num_media: string;
  messaging_service_sid: string | null;
}

export interface TwilioCall {
  sid: string;
  account_sid: string;
  from: string;
  to: string;
  status: "queued" | "ringing" | "in-progress" | "completed" | "busy" | "failed" | "no-answer" | "canceled";
  direction: "inbound" | "outbound-api" | "outbound-dial";
  date_created: string;
  date_updated: string;
  start_time: string | null;
  end_time: string | null;
  duration: string | null;
  price: string | null;
  price_unit: string | null;
  uri: string;
  answered_by: string | null;
}

export interface TwilioListResponse<T> {
  messages?: T[];
  calls?: T[];
  first_page_uri: string;
  next_page_uri: string | null;
  previous_page_uri: string | null;
  uri: string;
  page: number;
  page_size: number;
}

interface TwilioErrorResponse {
  code: number;
  message: string;
  more_info: string;
  status: number;
}

/**
 * Helper function for Twilio API calls
 */
async function twilioFetch<T>(
  endpoint: string,
  options: RequestInit & { params?: Record<string, string | number> } = {},
): Promise<T> {
  const credentials = getTwilioCredentials();
  if (!credentials) {
    throw new Error(
      "Twilio not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER environment variables.",
    );
  }

  const { accountSid, authToken } = credentials;

  // Build base URL
  const baseUrl = `https://api.twilio.com/${TWILIO_API_VERSION}/Accounts/${accountSid}`;
  let url = `${baseUrl}${endpoint}`;

  // Build authorization header (Basic Auth)
  const authString = btoa(`${accountSid}:${authToken}`);

  // For POST requests, use form-urlencoded body
  let body: string | undefined;
  const headers: Record<string, string> = {
    "Authorization": `Basic ${authString}`,
  };

  if (options.method === "POST" && options.params) {
    const formData = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      formData.append(key, String(value));
    });
    body = formData.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (options.params) {
    // For GET requests, add query parameters
    const queryParams = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      queryParams.append(key, String(value));
    });
    url += `?${queryParams.toString()}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as TwilioErrorResponse;
    throw new Error(
      `Twilio API error (${error.code}): ${error.message}\nMore info: ${error.more_info}`,
    );
  }

  return data as T;
}

/**
 * Send an SMS message
 * @param to - Recipient phone number in E.164 format (e.g., +14155552671)
 * @param body - Message text (max 1600 characters)
 * @param options - Optional parameters like MediaUrl for MMS
 */
export async function sendSMS(
  to: string,
  body: string,
  options?: {
    mediaUrl?: string[];
    statusCallback?: string;
  },
): Promise<TwilioMessage> {
  const credentials = getTwilioCredentials();
  if (!credentials) {
    throw new Error("Twilio credentials not configured");
  }

  const params: Record<string, string> = {
    To: to,
    From: credentials.phoneNumber,
    Body: body,
  };

  if (options?.mediaUrl && options.mediaUrl.length > 0) {
    options.mediaUrl.forEach((url, index) => {
      params[`MediaUrl[${index}]`] = url;
    });
  }

  if (options?.statusCallback) {
    params.StatusCallback = options.statusCallback;
  }

  return twilioFetch<TwilioMessage>("/Messages.json", {
    method: "POST",
    params,
  });
}

/**
 * Send a WhatsApp message
 * @param to - Recipient phone number in E.164 format with 'whatsapp:' prefix (e.g., whatsapp:+14155552671)
 * @param body - Message text
 */
export async function sendWhatsApp(
  to: string,
  body: string,
  options?: {
    mediaUrl?: string[];
    statusCallback?: string;
  },
): Promise<TwilioMessage> {
  const credentials = getTwilioCredentials();
  if (!credentials) {
    throw new Error("Twilio credentials not configured");
  }

  // Ensure 'whatsapp:' prefix
  const whatsappTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const whatsappFrom = credentials.phoneNumber.startsWith("whatsapp:")
    ? credentials.phoneNumber
    : `whatsapp:${credentials.phoneNumber}`;

  const params: Record<string, string> = {
    To: whatsappTo,
    From: whatsappFrom,
    Body: body,
  };

  if (options?.mediaUrl && options.mediaUrl.length > 0) {
    options.mediaUrl.forEach((url, index) => {
      params[`MediaUrl[${index}]`] = url;
    });
  }

  if (options?.statusCallback) {
    params.StatusCallback = options.statusCallback;
  }

  return twilioFetch<TwilioMessage>("/Messages.json", {
    method: "POST",
    params,
  });
}

/**
 * List messages
 * @param options - Filter options for listing messages
 */
export async function listMessages(options?: {
  to?: string;
  from?: string;
  dateSent?: string;
  limit?: number;
}): Promise<TwilioMessage[]> {
  const params: Record<string, string | number> = {};

  if (options?.to) params.To = options.to;
  if (options?.from) params.From = options.from;
  if (options?.dateSent) params.DateSent = options.dateSent;
  if (options?.limit) params.PageSize = options.limit;

  const response = await twilioFetch<TwilioListResponse<TwilioMessage>>(
    "/Messages.json",
    { params },
  );

  return response.messages || [];
}

/**
 * Get a specific message by SID
 * @param messageSid - The unique identifier for the message
 */
export function getMessage(messageSid: string): Promise<TwilioMessage> {
  return twilioFetch<TwilioMessage>(`/Messages/${messageSid}.json`);
}

/**
 * List calls
 * @param options - Filter options for listing calls
 */
export async function listCalls(options?: {
  to?: string;
  from?: string;
  status?: "queued" | "ringing" | "in-progress" | "completed" | "busy" | "failed" | "no-answer" | "canceled";
  startTime?: string;
  limit?: number;
}): Promise<TwilioCall[]> {
  const params: Record<string, string | number> = {};

  if (options?.to) params.To = options.to;
  if (options?.from) params.From = options.from;
  if (options?.status) params.Status = options.status;
  if (options?.startTime) params.StartTime = options.startTime;
  if (options?.limit) params.PageSize = options.limit;

  const response = await twilioFetch<TwilioListResponse<TwilioCall>>(
    "/Calls.json",
    { params },
  );

  return response.calls || [];
}

/**
 * Get a specific call by SID
 * @param callSid - The unique identifier for the call
 */
export function getCall(callSid: string): Promise<TwilioCall> {
  return twilioFetch<TwilioCall>(`/Calls/${callSid}.json`);
}

/**
 * Make an outbound call
 * @param to - Recipient phone number in E.164 format
 * @param twiml - TwiML instructions for the call (or URL to TwiML)
 */
export async function makeCall(
  to: string,
  twiml: string,
  options?: {
    twimlUrl?: string;
    statusCallback?: string;
    statusCallbackMethod?: "GET" | "POST";
    timeout?: number;
  },
): Promise<TwilioCall> {
  const credentials = getTwilioCredentials();
  if (!credentials) {
    throw new Error("Twilio credentials not configured");
  }

  const params: Record<string, string | number> = {
    To: to,
    From: credentials.phoneNumber,
  };

  // Use either Twiml or Url
  if (options?.twimlUrl) {
    params.Url = options.twimlUrl;
  } else {
    params.Twiml = twiml;
  }

  if (options?.statusCallback) {
    params.StatusCallback = options.statusCallback;
  }

  if (options?.statusCallbackMethod) {
    params.StatusCallbackMethod = options.statusCallbackMethod;
  }

  if (options?.timeout) {
    params.Timeout = options.timeout;
  }

  return twilioFetch<TwilioCall>("/Calls.json", {
    method: "POST",
    params,
  });
}

/**
 * Format phone number to E.164 format
 * Note: This is a simple helper. For production, use libphonenumber-js
 */
export function formatPhoneNumber(phone: string, defaultCountryCode = "+1"): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // If it doesn't start with +, add country code
  if (!phone.startsWith("+")) {
    // If it's 10 digits (US), add +1
    if (digits.length === 10) {
      return `${defaultCountryCode}${digits}`;
    }
    // If it's 11 digits starting with 1, add +
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }
    // Otherwise, just add +
    return `+${digits}`;
  }

  return phone;
}

/**
 * Format date for Twilio API queries (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Parse Twilio date strings to Date objects
 */
export function parseDate(dateString: string): Date {
  return new Date(dateString);
}
