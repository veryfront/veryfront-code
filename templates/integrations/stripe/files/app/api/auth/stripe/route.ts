import { setApiKey } from "../../../../lib/token-store.ts";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  const apiKey = (body as { apiKey?: unknown })?.apiKey;

  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return Response.json({ error: "API key is required" }, { status: 400 });
  }

  const isValidPrefix = apiKey.startsWith("sk_test_") || apiKey.startsWith("sk_live_");
  if (!isValidPrefix) {
    return Response.json(
      {
        error:
          "Invalid Stripe API key format. Key should start with sk_test_ or sk_live_",
      },
      { status: 400 },
    );
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/balance", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Stripe-Version": "2024-12-18.acacia",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return Response.json(
        {
          error: `Invalid API key: ${error.error?.message ?? "Authentication failed"}`,
        },
        { status: 401 },
      );
    }
  } catch {
    return Response.json(
      { error: "Failed to validate API key with Stripe" },
      { status: 500 },
    );
  }

  setApiKey(apiKey);

  return Response.json({
    success: true,
    message: "Stripe API key validated and stored successfully",
  });
}

export function GET(): Response {
  const apiKey = process.env.STRIPE_SECRET_KEY;

  return Response.json({
    authenticated: !!apiKey,
    hasEnvKey: !!apiKey,
  });
}
