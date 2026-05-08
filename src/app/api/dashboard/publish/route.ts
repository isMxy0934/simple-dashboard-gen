import { publishDashboardService } from "@/server/dashboards/service";
import { serviceResultToApiResponse } from "@/server/service-result";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  const result = await publishDashboardService(payload);
  if (result.ok) {
    return serviceResultToApiResponse(
      result,
      result.data.changed ? "OK" : "NO_CHANGES",
    );
  }
  return serviceResultToApiResponse(result);
}
