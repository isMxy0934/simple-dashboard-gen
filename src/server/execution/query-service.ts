import { executeBatch, executePreview } from "./execute-batch";

export async function handleExecuteBatchRoute(
  request: Request,
  options: { workspaceId?: string } = {},
): Promise<Response> {
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

  const outcome = await executeBatch(payload, { workspaceId: options.workspaceId });
  return Response.json(outcome.body, { status: outcome.httpStatus });
}

export async function handlePreviewRoute(
  request: Request,
  options: { workspaceId?: string } = {},
): Promise<Response> {
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

  const outcome = await executePreview(payload, {
    workspaceId: options.workspaceId,
  });
  return Response.json(outcome.body, { status: outcome.httpStatus });
}
