export type ApiErrorPayload = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly i18nKey: string;
  readonly payload: ApiErrorPayload | undefined;

  constructor(status: number, code: string, i18nKey: string, payload?: ApiErrorPayload) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.i18nKey = i18nKey;
    this.payload = payload;
  }
}
