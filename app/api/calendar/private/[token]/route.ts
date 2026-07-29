import { getRuntimeAuthConfiguration } from "@/lib/server/auth/runtime";
import { readPrivateCalendarSubscription } from "@/lib/server/phase7/calendar-subscriptions";
import { safeErrorResponse } from "@/lib/validation/server-observability";

export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ token: string }>;
}>;

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { token } = await context.params;
    const calendar = await readPrivateCalendarSubscription(
      getRuntimeAuthConfiguration().database,
      token,
      {
        generatedAt: Date.now(),
        origin: new URL(request.url).origin,
      },
    );
    return new Response(calendar, {
      headers: privateCalendarHeaders(),
    });
  } catch (error) {
    const response = safeErrorResponse(error, {
      operation: "read_private_calendar_subscription",
      route: "/api/calendar/private/[token]",
    });
    for (const [key, value] of privateCalendarHeaders()) {
      if (key.toLowerCase() !== "content-type") {
        response.headers.set(key, value);
      }
    }
    return response;
  }
}

function privateCalendarHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "text/calendar; charset=utf-8",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}
