import { assertCsrf } from "@/server/auth/csrf";
import { apiErrorToResponse } from "@/server/auth/route-helpers";

function secureCookieAttribute(request: Request): string {
  return new URL(request.url).protocol === "https:" ||
    process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertCsrf(request);
  } catch (error) {
    return apiErrorToResponse(error);
  }

  return Response.json(
    { status_code: 200, reason: "OK", data: null },
    {
      status: 200,
      headers: {
        "set-cookie": [
          "sds_session=",
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          "Max-Age=0",
          secureCookieAttribute(request),
        ]
          .filter(Boolean)
          .join("; "),
      },
    },
  );
}
