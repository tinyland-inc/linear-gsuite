import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileStaleEvents, stableGoogleEventId, syncCalendar } from "../src/google.js";

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

  function setupTestDir() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-reconcile-"));
    const sourceFile = path.join(tempDir, "events.json");
    const configFile = path.join(tempDir, "linear-gsuite.package.json");
    const localConfigFile = path.join(tempDir, "config.json");
    const oauthClientFile = path.join(tempDir, "client.json");
    const oauthTokenFile = path.join(tempDir, "token.json");

    writeJson(sourceFile, { timezone: "America/New_York", events: [] });
    writeJson(configFile, {
      name: "test-calendar",
      timezone: "America/New_York",
      sources: [{ id: "ops", type: "json-recurring-events", path: "./events.json" }]
    });
    writeJson(localConfigFile, { authMode: "user", calendarId: "primary", oauthTokenFile });
    writeJson(oauthClientFile, {
      installed: { client_id: "test-client", client_secret: "test-secret", redirect_uris: ["http://localhost"] }
    });
    writeJson(oauthTokenFile, { refresh_token: "refresh-token" });

    return { tempDir, configFile, localConfigFile, oauthClientFile, oauthTokenFile };
  }

  function syncOptions(t: ReturnType<typeof setupTestDir>, extra: Record<string, unknown> = {}) {
    return {
      configFile: t.configFile,
      localConfigFile: t.localConfigFile,
      authMode: "user" as const,
      oauthClientSecretsFile: t.oauthClientFile,
      oauthTokenFile: t.oauthTokenFile,
      calendarId: "primary",
      ...extra
    };
  }

  it("removes stale events for issues no longer in definition", async () => {
    const t = setupTestDir();
    const staleGcalId = "lgs-stale-event-from-completed-issue";
    const deletedIds: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          return jsonResponse({
            items: [{
              id: staleGcalId,
              summary: "TIN-999 — Old completed issue",
              status: "confirmed",
              extendedProperties: {
                private: { source: "linear-gsuite", sync_id: "TIN-999", source_id: "ops", google_event_id: staleGcalId }
              }
            }]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(deletedIds).toContain(staleGcalId);
  });

  it("does not remove events from sources not in config", async () => {
    const t = setupTestDir();
    const deletedIds: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        const prop = parsed.searchParams.get("privateExtendedProperty") || "";
        if (prop === "source_id=ops") return jsonResponse({ items: [] });
        if (prop.startsWith("source_id=other")) {
          throw new Error("Should not query for sources not in config");
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(deletedIds).toHaveLength(0);
  });

  it("dry-run logs stale events without deleting", async () => {
    const t = setupTestDir();
    const staleGcalId = "lgs-stale-dry-run";
    const deletedIds: string[] = [];
    const logged: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.join("\t")); };

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          return jsonResponse({
            items: [{
              id: staleGcalId,
              status: "confirmed",
              extendedProperties: {
                private: { source: "linear-gsuite", sync_id: "TIN-DRY", source_id: "ops", google_event_id: staleGcalId }
              }
            }]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t, { dryRun: true }), t.tempDir));
    console.log = origLog;

    expect(deletedIds).toHaveLength(0);
    expect(logged.some((l) => l.includes("would-remove-stale") && l.includes("TIN-DRY"))).toBe(true);
  });

  it("skips cancelled GCal tombstones during reconciliation", async () => {
    const t = setupTestDir();
    const deletedIds: string[] = [];

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          return jsonResponse({
            items: [{
              id: "lgs-tombstone",
              status: "cancelled",
              extendedProperties: {
                private: { source: "linear-gsuite", sync_id: "TIN-GHOST", source_id: "ops", google_event_id: "lgs-tombstone" }
              }
            }]
          });
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(deletedIds).toHaveLength(0);
  });

  it("handles pagination during reconciliation", async () => {
    const t = setupTestDir();
    const deletedIds: string[] = [];
    let listCallCount = 0;

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      const method = init?.method ?? "GET";
      const parsed = new URL(urlText);

      if (urlText === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "access-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (method === "GET" && parsed.pathname.endsWith("/events")) {
        if (parsed.searchParams.get("privateExtendedProperty") === "source_id=ops") {
          listCallCount += 1;
          if (!parsed.searchParams.get("pageToken")) {
            return jsonResponse({ items: [], nextPageToken: "page2" });
          }
          if (parsed.searchParams.get("pageToken") === "page2") {
            return jsonResponse({
              items: [{
                id: "lgs-stale-page2",
                status: "confirmed",
                extendedProperties: {
                  private: { source: "linear-gsuite", sync_id: "TIN-PAGE2", source_id: "ops", google_event_id: "lgs-stale-page2" }
                }
              }]
            });
          }
        }
        return jsonResponse({ items: [] });
      }
      if (method === "DELETE") {
        deletedIds.push(parsed.pathname.split("/").at(-1) || "");
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(syncCalendar(syncOptions(t), t.tempDir));
    expect(listCallCount).toBeGreaterThanOrEqual(2);
    expect(deletedIds).toContain("lgs-stale-page2");
  });
});
