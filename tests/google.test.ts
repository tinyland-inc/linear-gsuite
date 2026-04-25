import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCalendar } from "../src/google.js";

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("google calendar sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 410 Gone duplicate deletes as already pruned", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-google-"));
    const sourceFile = path.join(tempDir, "events.json");
    const configFile = path.join(tempDir, "linear-gsuite.package.json");
    const localConfigFile = path.join(tempDir, "config.json");
    const oauthClientFile = path.join(tempDir, "client.json");
    const oauthManagedFile = path.join(tempDir, "managed-client.json");
    const oauthTokenFile = path.join(tempDir, "token.json");

    writeJson(sourceFile, {
      timezone: "America/New_York",
      events: [
        {
          id: "ops-review",
          summary: "Ops review",
          description: "",
          start: "2026-05-01T13:00:00-04:00",
          end: "2026-05-01T13:30:00-04:00"
        }
      ]
    });
    writeJson(configFile, {
      name: "test-calendar",
      timezone: "America/New_York",
      sources: [
        {
          id: "ops",
          type: "json-recurring-events",
          path: "./events.json"
        }
      ]
    });
    writeJson(localConfigFile, {
      authMode: "user",
      calendarId: "primary",
      oauthClientManagedFile: oauthManagedFile,
      oauthTokenFile
    });
    writeJson(oauthClientFile, {
      installed: {
        client_id: "test-client",
        client_secret: "test-secret",
        redirect_uris: ["http://localhost"]
      }
    });
    writeJson(oauthTokenFile, {
      refresh_token: "refresh-token"
    });

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer"
        });
      }

      const parsed = new URL(urlText);
      if (method === "GET" && parsed.pathname.includes("/events/")) {
        return jsonResponse({ id: parsed.pathname.split("/").at(-1) });
      }

      if (method === "PUT" && parsed.pathname.includes("/events/")) {
        return jsonResponse({ id: parsed.pathname.split("/").at(-1) });
      }

      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "sync_id=ops-review") {
          return jsonResponse({
            items: [
              {
                id: "already-deleted-duplicate"
              }
            ]
          });
        }
        return jsonResponse({ items: [] });
      }

      if (method === "DELETE" && parsed.pathname.endsWith("/events/already-deleted-duplicate")) {
        return jsonResponse({ error: { code: 410, message: "Gone" } }, 410);
      }

      throw new Error(`Unexpected request: ${method} ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(
      syncCalendar({
        configFile,
        localConfigFile,
        authMode: "user",
        oauthClientSecretsFile: oauthClientFile,
        oauthTokenFile,
        calendarId: "primary"
      }, tempDir)
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/events/already-deleted-duplicate?sendUpdates=none"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
