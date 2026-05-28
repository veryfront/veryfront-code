import { getTwilioCredentials } from "./token-store.ts";

const TWILIO_API_VERSION = "2010-04-01";

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

function buildParams(params: Record<string, string | number>): string {
  return new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
}

function addMediaUrls(params: Record<string, string>, mediaUrl?: string[]): void {
  if (!mediaUrl?.length) return;

  for (const [index, url] of mediaUrl.entries()) {
    params[`MediaUrl[${index}]`] = url;
  }
}

function ensureTwilioCredentials(): NonNullable<ReturnType<typeof getTwilioCredentials>> {
  const credentials = getTwilioCredentials();
  if (!credentials) throw new Error("Twilio credentials not configured");
  return credentials;
}

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
  const baseUrl = `https://api.twilio.com/${TWILIO_API_VERSION}/Accounts/${accountSid}`;
  let url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
  };

  let body: string | undefined;
  const encodedParams = options.params ? buildParams(options.params) : undefined;

  if (encodedParams) {
    if (options.method === "POST") {
      body = encodedParams;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      url += `?${encodedParams}`;
    }
  }

  const response = await fetch(url, { ...options, headers, body });
  const data: unknown = await response.json();

  if (!response.ok) {
    const error = data as TwilioErrorResponse;
    throw new Error(`Twilio API error (${error.code}): ${error.message}\nMore info: ${error.more_info}`);
  }

  return data as T;
}

export async function sendSMS(
  to: string,
  body: string,
  options?: {
    mediaUrl?: string[];
    statusCallback?: string;
  },
): Promise<TwilioMessage> {
  const { phoneNumber } = ensureTwilioCredentials();

  const params: Record<string, string> = {
    To: to,
    From: phoneNumber,
    Body: body,
  };

  addMediaUrls(params, options?.mediaUrl);

  if (options?.statusCallback) params.StatusCallback = options.statusCallback;

  return twilioFetch<TwilioMessage>("/Messages.json", { method: "POST", params });
}

export async function sendWhatsApp(
  to: string,
  body: string,
  options?: {
    mediaUrl?: string[];
    statusCallback?: string;
  },
): Promise<TwilioMessage> {
  const { phoneNumber } = ensureTwilioCredentials();

  const whatsappTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const whatsappFrom = phoneNumber.startsWith("whatsapp:") ? phoneNumber : `whatsapp:${phoneNumber}`;

  const params: Record<string, string> = {
    To: whatsappTo,
    From: whatsappFrom,
    Body: body,
  };

  addMediaUrls(params, options?.mediaUrl);

  if (options?.statusCallback) params.StatusCallback = options.statusCallback;

  return twilioFetch<TwilioMessage>("/Messages.json", { method: "POST", params });
}

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

  const response = await twilioFetch<TwilioListResponse<TwilioMessage>>("/Messages.json", { params });
  return response.messages ?? [];
}

export function getMessage(messageSid: string): Promise<TwilioMessage> {
  return twilioFetch<TwilioMessage>(`/Messages/${messageSid}.json`);
}

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

  const response = await twilioFetch<TwilioListResponse<TwilioCall>>("/Calls.json", { params });
  return response.calls ?? [];
}

export function getCall(callSid: string): Promise<TwilioCall> {
  return twilioFetch<TwilioCall>(`/Calls/${callSid}.json`);
}

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
  const { phoneNumber } = ensureTwilioCredentials();

  const params: Record<string, string | number> = {
    To: to,
    From: phoneNumber,
  };

  if (options?.twimlUrl) {
    params.Url = options.twimlUrl;
  } else {
    params.Twiml = twiml;
  }

  if (options?.statusCallback) params.StatusCallback = options.statusCallback;
  if (options?.statusCallbackMethod) params.StatusCallbackMethod = options.statusCallbackMethod;
  if (options?.timeout) params.Timeout = options.timeout;

  return twilioFetch<TwilioCall>("/Calls.json", { method: "POST", params });
}

export function formatPhoneNumber(phone: string, defaultCountryCode = "+1"): string {
  const digits = phone.replace(/\D/g, "");

  if (phone.startsWith("+")) return phone;
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function parseDate(dateString: string): Date {
  return new Date(dateString);
}
