import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { LockerService } from "./service.ts";
import { addWebPage } from "./web.ts";

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function createApp(service: LockerService): Hono {
  const app = new Hono();

  addWebPage(app, "kiosk");

  app.post("/api/attempts", async (c) => {
    const { grantId, code } = await c.req.json<{ grantId?: string; code?: string }>();
    if (!grantId || !code) return c.json({ error: "grantId and code are required" }, 400);
    return c.json(service.view(await service.create(grantId, code)), 201);
  });

  app.get("/api/attempts/:id", (c) => {
    const attempt = service.get(c.req.param("id"));
    return attempt ? c.json(service.view(attempt)) : c.json({ error: "Unknown attempt" }, 404);
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

  return app;
}
