// Serves a built page and its assets from web/dist. Build them with: pnpm web
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Hono } from "hono";

const dist = new URL("../../web/dist/", import.meta.url);
const ASSET_NAME = /^[\w.-]+$/;
const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
};

export function addWebPage(app: Hono, page: "kiosk" | "owner" | "status"): void {
  app.get("/", (c) => {
    const file = new URL(`${page}.html`, dist);
    if (!existsSync(file)) return c.text("The web pages aren't built yet. Run: pnpm web", 503);
    return c.html(readFileSync(file, "utf8"));
  });

  app.get("/assets/:name", (c) => {
    const name = c.req.param("name");
    const type = TYPES[extname(name)];
    const file = new URL(`assets/${name}`, dist);
    if (!ASSET_NAME.test(name) || !type || !existsSync(file)) return c.text("Not found", 404);
    // File names include a content hash, so a changed file gets a new name.
    return c.body(readFileSync(file), 200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
  });
}
