import { setApiKey } from "../../../../lib/token-store.ts";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { apiKey } = body;

    if (!apiKey || typeof apiKey !== "string") {
      return Response.json(
        { error: "API key is required" },
        { status: 400 },
      );
    }

    if (!apiKey.startsWith("sk_test_") && !apiKey.startsWith("sk_live_")) {
      return Response.json(
        { error: "Invalid Stripe API key format. Key should start with sk_test_ or sk_live_" },
        { status: 400 },
      );
    }

    try {
      const response = await fetch("https://api.stripe.com/v1/balance", {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Stripe-Version": "2024-12-18.acacia",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        return Response.json(
          { error: `Invalid API key: ${error.error?.message || "Authentication failed"}` },
          { status: 401 },
        );
      }
    } catch (_error) {
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
  } catch (_error) {
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export function GET() {
  const apiKey = process.env.STRIPE_SECRET_KEY;

  return Response.json({
    authenticated: !!apiKey,
    hasEnvKey: !!apiKey,
  });
}
