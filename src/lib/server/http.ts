export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

export function errorJson(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}
