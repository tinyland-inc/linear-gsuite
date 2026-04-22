import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type {
  CalendarEventSpec,
  CalendarPackageManifest,
  CalendarSource,
  InstalledOAuthClient,
  JsonRecurringEventsFile,
  LoadedCalendarDefinition,
  LocalConfig,
  ResolvedCalendarEvent,
  UserTokenFile
} from "./types.js";
import {
  effectSync,
  expandHome,
  fail,
  fileExists,
  readJsonIfExists,
  readJsonUnknown,
  resolveFromCwd,
  resolveRelativeTo,
  writeJsonFile
} from "./utils.js";
import { resolveLinearIssuesSource } from "./linear.js";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const CONFIG_HOME = path.join(os.homedir(), ".config", "linear-gsuite");
export const DEFAULT_LOCAL_CONFIG = path.join(CONFIG_HOME, "config.json");
export const DEFAULT_OAUTH_TOKEN = path.join(CONFIG_HOME, "google-oauth-token.json");
export const DEFAULT_MANAGED_OAUTH_CLIENT = path.join(CONFIG_HOME, "google-oauth-client.json");
export const DEFAULT_SERVICE_ACCOUNT = path.join(CONFIG_HOME, "google-service-account.json");
export const DEFAULT_CALENDAR_SYNC_LABEL = "dev.linear-gsuite.google-calendar-sync";

const DEFAULT_OAUTH_CLIENTS = [
  path.join(
    os.homedir(),
    "Downloads",
    "client_secret_660337356796-oacuhf6gfoml65n1d7tctk7ssm1oa8ve.apps.googleusercontent.com.json"
  )
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw fail(`Expected non-empty string for ${field}`);
  }
  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw fail(`Expected boolean for ${field}`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw fail(`Expected number for ${field}`);
  }
  return value;
}

function normalizeEvent(raw: unknown, field: string): CalendarEventSpec {
  if (!isRecord(raw)) throw fail(`Expected object for ${field}`);
  const timeKindRaw = raw.timeKind;
  const timeKind =
    timeKindRaw === undefined ? "dateTime" :
    timeKindRaw === "dateTime" || timeKindRaw === "allDay" ? timeKindRaw :
    (() => {
      throw fail(`Unsupported timeKind for ${field}`);
    })();

  const recurrence = raw.recurrence === undefined
    ? []
    : Array.isArray(raw.recurrence)
      ? raw.recurrence.map((item, index) => asString(item, `${field}.recurrence[${index}]`))
      : (() => {
          throw fail(`Expected recurrence array for ${field}`);
        })();

  const remindersRaw = isRecord(raw.reminders) ? raw.reminders : {};

  return {
    id: asString(raw.id, `${field}.id`),
    summary: asString(raw.summary, `${field}.summary`),
    description: asOptionalString(raw.description) ?? "",
    timeKind,
    start: asString(raw.start, `${field}.start`),
    end: asString(raw.end, `${field}.end`),
    recurrence,
    reminders: {
      email: remindersRaw.email === undefined ? 1440 : asNumber(remindersRaw.email, `${field}.reminders.email`),
      popup: remindersRaw.popup === undefined ? 30 : asNumber(remindersRaw.popup, `${field}.reminders.popup`)
    }
  };
}

function normalizeEventsFile(raw: unknown, field: string): JsonRecurringEventsFile {
  if (!isRecord(raw)) throw fail(`Expected object for ${field}`);
  if (!Array.isArray(raw.events)) throw fail(`Expected events array for ${field}`);
  return {
    timezone: asString(raw.timezone, `${field}.timezone`),
    calendarId: asOptionalString(raw.calendarId),
    events: raw.events.map((event, index) => normalizeEvent(event, `${field}.events[${index}]`))
  };
}

function normalizeSource(raw: unknown, field: string): CalendarSource {
  if (!isRecord(raw)) throw fail(`Expected object for ${field}`);
  const type = asString(raw.type, `${field}.type`);

  if (type === "json-recurring-events") {
    return {
      id: asString(raw.id, `${field}.id`),
      type,
      path: asString(raw.path, `${field}.path`),
      enabled: raw.enabled === undefined ? true : asBoolean(raw.enabled, `${field}.enabled`),
      legacyIdentity: raw.legacyIdentity === undefined ? false : asBoolean(raw.legacyIdentity, `${field}.legacyIdentity`),
      description: asOptionalString(raw.description),
      timezone: asOptionalString(raw.timezone)
    };
  }

  if (type === "linear-issues") {
    return {
      id: asString(raw.id, `${field}.id`),
      type,
      apiKeyEnv: asString(raw.apiKeyEnv, `${field}.apiKeyEnv`),
      enabled: raw.enabled === undefined ? true : asBoolean(raw.enabled, `${field}.enabled`),
      description: asOptionalString(raw.description),
      teamKey: asOptionalString(raw.teamKey),
      projectName: asOptionalString(raw.projectName),
      assignee: asOptionalString(raw.assignee) as "me" | string | undefined,
      labelNames: Array.isArray(raw.labelNames)
        ? raw.labelNames.map((item, index) => asString(item, `${field}.labelNames[${index}]`))
        : undefined,
      stateNames: Array.isArray(raw.stateNames)
        ? raw.stateNames.map((item, index) => asString(item, `${field}.stateNames[${index}]`))
        : undefined,
      excludeStateTypes: Array.isArray(raw.excludeStateTypes)
        ? raw.excludeStateTypes.map((item, index) => asString(item, `${field}.excludeStateTypes[${index}]`)) as never[]
        : undefined,
      dueWithinDays: raw.dueWithinDays === undefined ? undefined : asNumber(raw.dueWithinDays, `${field}.dueWithinDays`),
      reminders: isRecord(raw.reminders)
        ? {
            email: raw.reminders.email === undefined ? 1440 : asNumber(raw.reminders.email, `${field}.reminders.email`),
            popup: raw.reminders.popup === undefined ? 60 : asNumber(raw.reminders.popup, `${field}.reminders.popup`)
          }
        : undefined
    };
  }

  throw fail(`Unsupported source type '${type}' in ${field}`);
}

function normalizeManifest(raw: unknown, field: string): CalendarPackageManifest {
  if (!isRecord(raw)) throw fail(`Expected object for ${field}`);
  if (!Array.isArray(raw.sources)) throw fail(`Expected sources array for ${field}`);
  const agents = isRecord(raw.agents) ? raw.agents : {};
  const calendarSyncRaw = isRecord(agents["calendar-sync"]) ? agents["calendar-sync"] : undefined;

  return {
    name: asOptionalString(raw.name),
    version: typeof raw.version === "string" || typeof raw.version === "number" ? raw.version : undefined,
    timezone: asOptionalString(raw.timezone),
    calendarId: asOptionalString(raw.calendarId),
    sources: raw.sources.map((source, index) => normalizeSource(source, `${field}.sources[${index}]`)),
    agents: calendarSyncRaw
      ? {
          "calendar-sync": {
            label: asOptionalString(calendarSyncRaw.label),
            startIntervalSeconds:
              calendarSyncRaw.startIntervalSeconds === undefined
                ? undefined
                : asNumber(calendarSyncRaw.startIntervalSeconds, `${field}.agents.calendar-sync.startIntervalSeconds`)
          }
        }
      : undefined
  };
}

export function discoverCalendarPackageFile(cwd = process.cwd(), projectRoot?: string) {
  return Effect.gen(function* () {
    const candidates = [
      path.join(cwd, "linear-gsuite.package.json"),
      path.join(cwd, "calendar", "linear-gsuite.package.json"),
      path.join(cwd, "calendar", "package.json"),
      projectRoot ? path.join(projectRoot, "examples", "tinyland-business-ops", "linear-gsuite.package.json") : ""
    ].filter(Boolean);

    const match = candidates.find((file) => fs.existsSync(file));
    if (!match) {
      return yield* Effect.fail(
        fail("No calendar package manifest found. Pass --config or create ./linear-gsuite.package.json.")
      );
    }
    return match;
  });
}

export function loadLocalConfig(file = DEFAULT_LOCAL_CONFIG) {
  return Effect.gen(function* () {
    const raw = yield* readJsonIfExists(file, {});
    if (!isRecord(raw)) return {} satisfies LocalConfig;
    return {
      authMode:
        raw.authMode === "user" || raw.authMode === "service-account" ? raw.authMode : undefined,
      calendarId: asOptionalString(raw.calendarId),
      oauthClientFile: asOptionalString(raw.oauthClientFile),
      oauthClientManagedFile: asOptionalString(raw.oauthClientManagedFile),
      oauthTokenFile: asOptionalString(raw.oauthTokenFile),
      serviceAccountFile: asOptionalString(raw.serviceAccountFile),
      impersonate: asOptionalString(raw.impersonate)
    } satisfies LocalConfig;
  });
}

export function saveLocalConfig(patch: Partial<LocalConfig>, file = DEFAULT_LOCAL_CONFIG) {
  return Effect.gen(function* () {
    const current = yield* loadLocalConfig(file);
    yield* writeJsonFile(file, { ...current, ...patch });
  });
}

export function discoverOAuthClientFile(explicitFile?: string) {
  return Effect.gen(function* () {
    if (explicitFile) {
      const resolved = expandHome(explicitFile);
      if (!fileExists(resolved)) return yield* Effect.fail(fail(`OAuth client file not found: ${explicitFile}`));
      return resolved;
    }

    for (const candidate of DEFAULT_OAUTH_CLIENTS) {
      if (fileExists(candidate)) return candidate;
    }

    const downloads = path.join(os.homedir(), "Downloads");
    const files = yield* effectSync("scan ~/Downloads", () => {
      if (!fs.existsSync(downloads)) return [];
      return fs
        .readdirSync(downloads)
        .filter((name) => name.startsWith("client_secret_") && name.endsWith(".json"))
        .map((name) => path.join(downloads, name));
    });

    const ranked = files
      .filter((file) => {
        try {
          const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { installed?: { client_id?: string } };
          return Boolean(parsed.installed?.client_id);
        } catch {
          return false;
        }
      })
      .sort((left, right) => scoreClientFile(right) - scoreClientFile(left));

    if (ranked.length === 0) {
      return yield* Effect.fail(fail("No installed-app Google OAuth client file found in ~/Downloads."));
    }

    return ranked[0];
  });
}

function scoreClientFile(file: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { installed?: Record<string, unknown> };
    const installed = parsed.installed ?? {};
    let score = 0;
    if (installed.project_id === "sulliwoodmailsurface") score += 100;
    if (typeof installed.client_id === "string" && installed.client_id.startsWith("660337356796-")) score += 100;
    if (Array.isArray(installed.redirect_uris) && installed.redirect_uris.some((uri) => typeof uri === "string" && uri.startsWith("http://localhost"))) {
      score += 50;
    }
    return score;
  } catch {
    return 0;
  }
}

export function readInstalledClient(file: string) {
  return Effect.gen(function* () {
    const raw = yield* readJsonUnknown(file);
    if (!isRecord(raw) || !isRecord(raw.installed)) {
      return yield* Effect.fail(fail(`Expected installed Google OAuth client in ${file}`));
    }
    return {
      project_id: asOptionalString(raw.installed.project_id),
      client_id: asString(raw.installed.client_id, "installed.client_id"),
      client_secret: asOptionalString(raw.installed.client_secret),
      redirect_uris: Array.isArray(raw.installed.redirect_uris)
        ? raw.installed.redirect_uris.map((item, index) => asString(item, `installed.redirect_uris[${index}]`))
        : []
    } satisfies InstalledOAuthClient;
  });
}

export function ensureManagedOAuthClientFile(sourceFile: string, targetFile = DEFAULT_MANAGED_OAUTH_CLIENT) {
  return Effect.gen(function* () {
    const source = expandHome(sourceFile);
    const target = expandHome(targetFile);
    if (!fileExists(source)) return yield* Effect.fail(fail(`OAuth client file not found: ${sourceFile}`));
    yield* effectSync(`copy ${source} -> ${target}`, () => {
      const sourceContents = fs.readFileSync(source, "utf8");
      const targetContents = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      if (source !== target && sourceContents !== targetContents) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, sourceContents, { mode: 0o600 });
      } else if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, sourceContents, { mode: 0o600 });
      }
      try {
        fs.chmodSync(target, 0o600);
      } catch {
        // Best effort.
      }
    });
    return target;
  });
}

export function loadCalendarDefinition(configFile: string, cwd = process.cwd()) {
  return Effect.gen(function* () {
    const resolvedConfigFile = resolveFromCwd(configFile, cwd);
    const raw = yield* readJsonUnknown(resolvedConfigFile);

    if (isRecord(raw) && Array.isArray(raw.events)) {
      const sourceConfig = normalizeEventsFile(raw, resolvedConfigFile);
      return {
        configFile: resolvedConfigFile,
        format: "legacy-events-file",
        timezone: sourceConfig.timezone,
        calendarId: sourceConfig.calendarId,
        agents: undefined,
        events: sourceConfig.events.map((event) => ({
          ...event,
          sourceId: "legacy-events-file",
          identityKey: event.id,
          recurrence: event.recurrence ?? [],
          reminders: event.reminders ?? { email: 1440, popup: 30 },
          timeKind: event.timeKind ?? "dateTime"
        })),
        sources: [
          {
            id: "legacy-events-file",
            type: "json-recurring-events",
            path: resolvedConfigFile,
            eventCount: sourceConfig.events.length,
            implemented: true
          }
        ],
        watchPaths: [resolvedConfigFile]
      } satisfies LoadedCalendarDefinition;
    }

    const manifest = normalizeManifest(raw, resolvedConfigFile);
    const manifestDir = path.dirname(resolvedConfigFile);
    const watchPaths = [resolvedConfigFile];
    const events: ResolvedCalendarEvent[] = [];
    const sources: LoadedCalendarDefinition["sources"] = [];
    const seenIdentityKeys = new Set<string>();
    let timezone = manifest.timezone;

    for (const source of manifest.sources) {
      if (source.enabled === false) continue;

      if (source.type === "linear-issues") {
        const resolvedEvents = yield* resolveLinearIssuesSource(source);
        if (!timezone) timezone = manifest.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
        for (const event of resolvedEvents) {
          if (seenIdentityKeys.has(event.identityKey)) {
            return yield* Effect.fail(fail(`Duplicate calendar identity key '${event.identityKey}' in ${resolvedConfigFile}`));
          }
          seenIdentityKeys.add(event.identityKey);
          events.push(event);
        }

        sources.push({
          id: source.id,
          type: source.type,
          eventCount: resolvedEvents.length,
          implemented: true
        });
        continue;
      }

      const sourceFile = resolveRelativeTo(source.path, manifestDir);
      const rawSource = yield* readJsonUnknown(sourceFile);
      const sourceConfig = normalizeEventsFile(rawSource, sourceFile);
      watchPaths.push(sourceFile);

      const sourceTimezone = source.timezone ?? sourceConfig.timezone;
      if (!timezone) timezone = sourceTimezone;
      if (timezone && sourceTimezone && timezone !== sourceTimezone) {
        return yield* Effect.fail(
          fail(`Timezone mismatch between package and source ${source.id}: ${timezone} vs ${sourceTimezone}`)
        );
      }

      for (const event of sourceConfig.events) {
        const identityKey = source.legacyIdentity ? event.id : `${source.id}:${event.id}`;
        if (seenIdentityKeys.has(identityKey)) {
          return yield* Effect.fail(fail(`Duplicate calendar identity key '${identityKey}' in ${resolvedConfigFile}`));
        }
        seenIdentityKeys.add(identityKey);
        events.push({
          ...event,
          sourceId: source.id,
          identityKey,
          recurrence: event.recurrence ?? [],
          reminders: event.reminders ?? { email: 1440, popup: 30 },
          timeKind: event.timeKind ?? "dateTime"
        });
      }

      sources.push({
        id: source.id,
        type: source.type,
        path: sourceFile,
        eventCount: sourceConfig.events.length,
        legacyIdentity: source.legacyIdentity ?? false,
        implemented: true
      });
    }

    if (!timezone) {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }

    return {
      configFile: resolvedConfigFile,
      format: "calendar-package",
      timezone,
      calendarId: manifest.calendarId,
      agents: manifest.agents,
      events,
      sources,
      watchPaths
    } satisfies LoadedCalendarDefinition;
  });
}

export function readUserToken(file: string) {
  return Effect.gen(function* () {
    const raw = yield* readJsonUnknown(file);
    if (!isRecord(raw)) return yield* Effect.fail(fail(`Expected token JSON object in ${file}`));
    return {
      access_token: asOptionalString(raw.access_token),
      refresh_token: asOptionalString(raw.refresh_token),
      token_type: asOptionalString(raw.token_type),
      scope: asOptionalString(raw.scope),
      expires_at: asOptionalString(raw.expires_at),
      issued_at: asOptionalString(raw.issued_at)
    } satisfies UserTokenFile;
  });
}
