export async function consumeRequestLimit(env, auth, fetchFn = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchFn(`${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1/rpc/consume_parsitasks_request`, {
      method: "POST",
      signal: controller.signal,
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Request limiter unavailable");
    const result = await response.json();
    if (typeof result?.allowed !== "boolean" || !Number.isInteger(result.retryAfter) || result.retryAfter < 1 || result.retryAfter > 60) throw new Error("Invalid request limiter response");
    return result;
  } finally { clearTimeout(timeout); }
}
