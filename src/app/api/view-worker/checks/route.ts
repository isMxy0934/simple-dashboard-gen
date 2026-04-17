export async function PUT(): Promise<Response> {
  return Response.json(
    {
      status_code: 410,
      reason: "VIEW_WORKER_CHECKS_ROUTE_REMOVED",
      data: null,
    },
    { status: 410 },
  );
}
