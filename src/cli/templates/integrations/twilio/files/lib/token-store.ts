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

/**
 * Get Twilio credentials from environment variables
 */
export function getTwilioCredentials(): {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
} | null {
  const accountSid = getEnv("TWILIO_ACCOUNT_SID");
  const authToken = getEnv("TWILIO_AUTH_TOKEN");
  const phoneNumber = getEnv("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !phoneNumber) {
    return null;
  }

  return { accountSid, authToken, phoneNumber };
}

/**
 * Check if Twilio is authenticated
 */
export function isAuthenticated(): boolean {
  return getTwilioCredentials() !== null;
}

/**
 * Get Twilio Account SID
 */
export function getAccountSid(): string | null {
  return getEnv("TWILIO_ACCOUNT_SID") || null;
}

/**
 * Get Twilio Auth Token
 */
export function getAuthToken(): string | null {
  return getEnv("TWILIO_AUTH_TOKEN") || null;
}

/**
 * Get Twilio Phone Number
 */
export function getPhoneNumber(): string | null {
  return getEnv("TWILIO_PHONE_NUMBER") || null;
}
