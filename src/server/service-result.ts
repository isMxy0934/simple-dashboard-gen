import "server-only";

export type ServiceResult<TData, TDetails = unknown> =
  | { ok: true; data: TData }
  | {
      ok: false;
      code: string;
      status: number;
      reason: string;
      message_i18n_key?: string;
      details?: TDetails;
    };

export function serviceOk<TData>(data: TData): ServiceResult<TData> {
  return { ok: true, data };
}

export function serviceError<TDetails = unknown>(input: {
  code: string;
  status: number;
  reason?: string;
  messageI18nKey?: string;
  details?: TDetails;
}): ServiceResult<never, TDetails> {
  return {
    ok: false,
    code: input.code,
    status: input.status,
    reason: input.reason ?? input.code,
    ...(input.messageI18nKey === undefined
      ? {}
      : { message_i18n_key: input.messageI18nKey }),
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export function serviceResultToApiResponse<TData>(
  result: ServiceResult<TData>,
  successReason = "OK",
): Response {
  if (result.ok) {
    return Response.json({
      status_code: 200,
      reason: successReason,
      data: result.data,
    });
  }

  return Response.json(
    {
      status_code: result.status,
      reason: result.reason,
      ...(result.message_i18n_key
        ? { message_i18n_key: result.message_i18n_key }
        : {}),
      data: result.details ?? null,
    },
    { status: result.status },
  );
}
