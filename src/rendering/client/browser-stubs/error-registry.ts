interface BrowserErrorOptions {
  detail?: string;
  status?: number;
  context?: Record<string, unknown>;
}

function createBrowserError(name: string, fallbackMessage: string) {
  return {
    create(options: BrowserErrorOptions = {}) {
      const error = new Error(options.detail ?? fallbackMessage);
      error.name = name;
      Object.assign(error, {
        status: options.status,
        context: options.context,
      });
      return error;
    },
  };
}

export const NETWORK_ERROR = createBrowserError("NetworkError", "Network request failed");
export const SECURITY_VIOLATION = createBrowserError("SecurityViolation", "Security violation");
