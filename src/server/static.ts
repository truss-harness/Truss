import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export async function serveStatic(request: Request, publicDir: string): Promise<Response> {
  const url = new URL(request.url);
  const publicRoot = resolve(publicDir);
  const relativePath = routeToStaticPath(url.pathname);
  const filePath = resolve(publicRoot, relativePath);

  if (!isInsideDirectory(filePath, publicRoot)) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(file, {
    headers: {
      "Cache-Control": relativePath.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "Content-Type": contentType(filePath),
    },
  });
}

function routeToStaticPath(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return "index.html";
  }

  const decoded = decodeURIComponent(pathname.replace(/^\/+/, ""));

  if (!decoded.includes(".") && !decoded.startsWith("assets/")) {
    return "index.html";
  }

  return decoded;
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  return filePath === directory || filePath.startsWith(`${directory}${sep}`);
}

function contentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
