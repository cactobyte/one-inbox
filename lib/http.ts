/**
 * Small helpers so every API route answers in the same shape. The internal
 * API is designed as if it were already public (CLAUDE.md rule 4): one
 * envelope, real status codes.
 */

export type ApiErrorBody = {
  error: { message: string; code: string };
};

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export function jsonError(
  message: string,
  status: number,
  code: string,
): Response {
  return Response.json(
    { error: { message, code } } satisfies ApiErrorBody,
    { status },
  );
}
