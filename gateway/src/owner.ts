// The lock owner's page: create, list and revoke access. It uses the gateway's wallet, so it must
// never be reachable from outside this machine. See owner-main.ts.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import QRCode from "qrcode";
import type { ArkivBackend } from "./arkiv/backend.ts";
import { hashCode } from "./grants.ts";
import { errorText } from "./log/errors.ts";

const MAX_MINUTES = 30 * 24 * 60;
const MAX_LABEL_BYTES = 40;
const page = readFileSync(new URL("../public/owner.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/kiosk.css", import.meta.url), "utf8");

export interface OwnerOptions {
  lockerId: string;
  port: number;
  kioskUrl: string;
  statusUrl: string;
  gateway: string;
}

export function createOwnerApp(
  arkiv: Pick<ArkivBackend, "createGrant" | "revokeGrant" | "listGrants" | "readStatus">,
  options: OwnerOptions,
): Hono {
  const app = new Hono();
  const hosts = new Set([`localhost:${options.port}`, `127.0.0.1:${options.port}`]);

  // Stops other websites open in the same browser from using this page: the Host check blocks DNS
  // rebinding, and a required JSON body stops plain cross-site form posts.
  app.use(async (c, next) => {
    if (!hosts.has(c.req.header("host") ?? "")) return c.text("Forbidden", 403);
    if (c.req.method === "POST") {
      const origin = c.req.header("origin");
      const sameOrigin = !origin || hosts.has(origin.replace(/^https?:\/\//, ""));
      if (!sameOrigin || !c.req.header("content-type")?.startsWith("application/json")) {
        return c.json({ error: "Forbidden" }, 403);
      }
    }
    await next();
  });

  app.get("/", (c) => c.html(page));
  app.get("/kiosk.css", (c) => c.text(styles, 200, { "content-type": "text/css" }));

  app.get("/api/state", async (c) => {
    try {
      const [grants, { locker }] = await Promise.all([
        arkiv.listGrants(options.lockerId),
        arkiv.readStatus(options.lockerId),
      ]);
      return c.json({ lockerId: options.lockerId, gateway: options.gateway, statusUrl: options.statusUrl, locker, grants });
    } catch (error) {
      console.warn(`[owner] read failed: ${errorText(error)}`);
      return c.json({ error: "Arkiv can't be read right now" }, 503);
    }
  });

  app.post("/api/grants", async (c) => {
    const { minutes, label } = await c.req.json<{ minutes?: unknown; label?: unknown }>();
    if (!Number.isInteger(minutes) || (minutes as number) < 1 || (minutes as number) > MAX_MINUTES) {
      return c.json({ error: "Choose a time between 1 minute and 30 days" }, 400);
    }
    const note = typeof label === "string" ? label.trim() : "";
    if (Buffer.byteLength(note) > MAX_LABEL_BYTES) return c.json({ error: "Keep the note under 40 characters" }, 400);

    // The code exists only in this response. Arkiv gets its hash, so it can't be shown again later.
    const code = randomBytes(16).toString("base64url");
    try {
      const id = await arkiv.createGrant(options.lockerId, (minutes as number) * 60, hashCode(code), note);
      const link = `${options.kioskUrl}/?grant=${id}#code=${code}`;
      const svg = await QRCode.toString(link, { type: "svg", margin: 2 });
      return c.json({ id, link, qr: `data:image/svg+xml,${encodeURIComponent(svg)}` }, 201);
    } catch (error) {
      console.warn(`[owner] create failed: ${errorText(error)}`);
      return c.json({ error: "Couldn't write to Arkiv. Check the wallet's tGLM and try again." }, 502);
    }
  });

  app.post("/api/grants/:id/revoke", async (c) => {
    try {
      await arkiv.revokeGrant(c.req.param("id"));
      return c.json({ revoked: true });
    } catch (error) {
      console.warn(`[owner] revoke failed: ${errorText(error)}`);
      return c.json({ error: "Couldn't revoke it. It may have just expired, or Arkiv can't be reached." }, 502);
    }
  });

  return app;
}
