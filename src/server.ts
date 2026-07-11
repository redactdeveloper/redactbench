import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { resolveContainedPath } from "./workspace.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function securityHeaders(contentType: string) {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}

export async function serveReport(
  reportDirectory: string,
  port: number
): Promise<{ server: Server; url: string }> {
  const root = resolve(reportDirectory);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, securityHeaders("text/plain; charset=utf-8"));
        response.end("Method not allowed\n");
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const decoded = decodeURIComponent(url.pathname);
      const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
      const file = resolveContainedPath(root, relative);
      const fileStat = await stat(file);
      if (!fileStat.isFile()) {
        throw new Error("not a file");
      }
      const body = await readFile(file);
      const contentType =
        CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
      response.writeHead(200, securityHeaders(contentType));
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
      response.end("Not found\n");
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, url: `http://127.0.0.1:${actualPort}` };
}
