function routeGroup(pathname) {
  if (pathname.startsWith("/api/google-drive/")) return "google-drive";
  if (pathname.startsWith("/api/google-calendar/")) return "google-calendar";
  if (pathname === "/mcp" || pathname === "/mcp/health") return "mcp";
  if (pathname.startsWith("/oauth/")) return "oauth";
  return "public-assets";
}

export function reportRequestFailure(request, { logger = console, createId = () => crypto.randomUUID() } = {}) {
  const requestId = createId();
  const method = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"].includes(request.method) ? request.method : "OTHER";
  // Do not log the exception, request URL, headers or body: they may contain private data.
  logger.error(JSON.stringify({ event: "request_failed", requestId, route: routeGroup(new URL(request.url).pathname), method, status: 500 }));
  return requestId;
}
