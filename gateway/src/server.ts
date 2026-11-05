import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { LockerService } from "./service.ts";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const kiosk = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

export function createApp(service: LockerService, options: { devMocks: boolean }): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(kiosk));

  app.post("/api/attempts", async (c) => {
    const { grantId } = await c.req.json<{ grantId?: string }>();
    if (!grantId) return c.json({ error: "grantId is required" }, 400);
    return c.json(service.view(service.create(grantId)), 201);
  });

  app.get("/api/attempts/:id", (c) => {
    const attempt = service.get(c.req.param("id"));
    return attempt ? c.json(service.view(attempt)) : c.json({ error: "Unknown attempt" }, 404);
  });

  app.get("/api/attempts/:id/world", async (c) => {
    try {
      return c.redirect(await service.startWorld(c.req.param("id")));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 409);
    }
  });

  app.get("/world/callback", async (c) => {
    const { state, code, error } = c.req.query();
    if (!state) return c.text("Missing state", 400);
    const attempt = await service.finishWorld({ state, code, error });
    return attempt ? c.redirect(`/?attempt=${attempt.id}`) : c.text("Unknown or used World check", 400);
  });

  app.post(
    "/api/attempts/:id/photo",
    bodyLimit({ maxSize: MAX_PHOTO_BYTES, onError: (c) => c.json({ error: "Photo too large" }, 413) }),
    async (c) => {
      const { image } = await c.req.json<{ image?: string }>();
      if (!image?.startsWith("data:image/jpeg;base64,")) return c.json({ error: "Expected a JPEG data URL" }, 400);
      try {
        return c.json(service.view(await service.submitPhoto(c.req.param("id"), image)));
      } catch (error) {
        return c.json({ error: (error as Error).message }, 409);
      }
    },
  );

  if (options.devMocks) {
    app.get("/dev/world", (c) => {
      const state = encodeURIComponent(c.req.query("state") ?? "");
      return c.html(`<!doctype html><title>Fake World ID</title><h1>Fake World ID</h1>
        <p><a href="/world/callback?state=${state}&code=dev">Approve</a></p>
        <p><a href="/world/callback?state=${state}&error=access_denied">Deny</a></p>`);
    });
  }

  return app;
}
