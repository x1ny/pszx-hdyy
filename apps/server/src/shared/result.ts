// The one shared vocabulary every module returns through. HTTP status stays
// 200 for both success and defined business outcomes — "code" carries the
// business state, not the status line. Real non-200s are reserved for
// things that aren't business outcomes at all: malformed request bodies
// (zValidator's error hook) and uncaught exceptions (index.ts's onError).
export type ApiError =
  | { code: "UNAUTHORIZED"; message: string }
  | { code: "VALIDATION_ERROR"; message: string }
  | { code: "INTERNAL_ERROR"; message: string };

export type ApiResult<T> = { code: "OK"; data: T } | ApiError;

export const ok = <T>(data: T): ApiResult<T> => ({ code: "OK", data });

export const err = (error: ApiError): ApiResult<never> => error;
