import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Effect } from "effect";
import { DEFAULT_CALENDAR_SYNC_LABEL } from "./config.js";
import type { LoadedCalendarDefinition } from "./types.js";
import { effectSync, fail, writeTextFile } from "./utils.js";

const HOME = os.homedir();
const NODE_BIN = process.execPath;
const MINIMAL_PATH = `${HOME}/.nix-profile/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
const LOG_DIR = path.join(HOME, "Library", "Logs");

function assertDarwin() {
  if (process.platform !== "darwin") {
    throw fail("launchd management is only supported on macOS.");
  }
}

function plistPath(label: string) {
  return path.join(HOME, "Library", "LaunchAgents", `${label}.plist`);
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderPlistValue(value: unknown, indent = "  "): string {
  if (typeof value === "string") return `${indent}<string>${xmlEscape(value)}</string>\n`;
  if (typeof value === "boolean") return `${indent}<${value ? "true" : "false"}/>\n`;
  if (Number.isInteger(value)) return `${indent}<integer>${value}</integer>\n`;
  if (Array.isArray(value)) {
    let out = `${indent}<array>\n`;
    for (const item of value) out += renderPlistValue(item, `${indent}  `);
    out += `${indent}</array>\n`;
    return out;
  }
  if (value && typeof value === "object") {
    let out = `${indent}<dict>\n`;
    for (const [key, item] of Object.entries(value)) {
      out += `${indent}  <key>${xmlEscape(key)}</key>\n`;
      out += renderPlistValue(item, `${indent}  `);
    }
    out += `${indent}</dict>\n`;
    return out;
  }
  throw fail(`Unsupported plist value: ${String(value)}`);
}

function renderPlist(config: Record<string, unknown>) {
  let body = "";
  for (const [key, value] of Object.entries(config)) {
    body += `  <key>${xmlEscape(key)}</key>\n`;
    body += renderPlistValue(value, "  ");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`;
}

function currentUid() {
  if (typeof process.getuid !== "function") {
    throw fail("launchd management requires process.getuid() support.");
  }
  return process.getuid();
}

function launchctl(args: string[]) {
  execFileSync("/bin/launchctl", args, {
    stdio: "ignore"
  });
}

function launchctlRead(args: string[]) {
  return execFileSync("/bin/launchctl", args, {
    stdio: "pipe",
    encoding: "utf8"
  });
}

function summarizeLaunchctlPrint(output: string) {
  const keep: string[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("resource coalition =") || trimmed.startsWith("jetsam coalition =")) break;
    if (
      trimmed.startsWith("state =") ||
      trimmed.startsWith("path =") ||
      trimmed.startsWith("type =") ||
      trimmed.startsWith("active count =") ||
      trimmed.startsWith("program =") ||
      trimmed.startsWith("working directory =") ||
      trimmed.startsWith("stdout path =") ||
      trimmed.startsWith("stderr path =") ||
      trimmed.startsWith("last exit code =") ||
      trimmed.startsWith("runs =")
    ) {
      keep.push(trimmed);
    }
  }
  return keep.join("\n");
}

function extractLaunchctlField(output: string, prefix: string) {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return "";
}

function determineInvocation(scriptFile: string, projectRoot: string): string[] {
  const distCli = path.join(projectRoot, "dist", "cli.js");
  if (scriptFile.endsWith(".ts") && fs.existsSync(distCli)) {
    return [NODE_BIN, distCli];
  }
  return [NODE_BIN, scriptFile];
}

export function installLaunchdSync(options: {
  label?: string;
  definition: LoadedCalendarDefinition;
  configFile: string;
  localConfigFile: string;
  scriptFile: string;
  projectRoot: string;
  syncIntervalSeconds?: number;
  environment?: Record<string, string>;
}) {
  return Effect.gen(function* () {
    assertDarwin();
    const label = options.label || DEFAULT_CALENDAR_SYNC_LABEL;
    const targetPlist = plistPath(label);
    const invocation = determineInvocation(options.scriptFile, options.projectRoot);
    const uid = currentUid();
    const environmentEntries = Object.entries(options.environment ?? {});
    const plist = renderPlist({
      Label: label,
      WorkingDirectory: options.projectRoot,
      ProgramArguments: [
        "/usr/bin/env",
        "-i",
        `HOME=${HOME}`,
        `PATH=${MINIMAL_PATH}`,
        `XDG_CONFIG_HOME=${HOME}/.config`,
        `XDG_CACHE_HOME=${HOME}/.cache`,
        `XDG_DATA_HOME=${HOME}/.local/share`,
        `XDG_STATE_HOME=${HOME}/.local/state`,
        ...environmentEntries.map(([key, value]) => `${key}=${value}`),
        ...invocation,
        "calendar",
        "sync",
        "--config",
        options.configFile,
        "--local-config-file",
        options.localConfigFile
      ],
      RunAtLoad: true,
      StartInterval: options.syncIntervalSeconds ?? 21600,
      WatchPaths: Array.from(
        new Set([options.configFile, ...options.definition.watchPaths, options.localConfigFile].map((file) => path.resolve(file)))
      ),
      StandardOutPath: path.join(LOG_DIR, "linear-gsuite-calendar-sync.out.log"),
      StandardErrorPath: path.join(LOG_DIR, "linear-gsuite-calendar-sync.err.log")
    });

    yield* effectSync("prepare launchd directories", () => {
      fs.mkdirSync(path.dirname(targetPlist), { recursive: true });
      fs.mkdirSync(LOG_DIR, { recursive: true });
    });
    yield* writeTextFile(targetPlist, plist);
    yield* effectSync(`lint ${targetPlist}`, () => {
      execFileSync("/usr/bin/plutil", ["-lint", targetPlist], { stdio: "ignore" });
    });

    try {
      launchctl(["bootout", `gui/${uid}`, targetPlist]);
    } catch {
      // Best effort.
    }
    launchctl(["bootstrap", `gui/${uid}`, targetPlist]);
    try {
      launchctl(["enable", `gui/${uid}/${label}`]);
    } catch {
      // Best effort.
    }
    try {
      launchctl(["kickstart", "-k", `gui/${uid}/${label}`]);
    } catch {
      // Best effort.
    }

    console.log(`Installed ${label}`);
    console.log(`plist: ${targetPlist}`);
  });
}

export function uninstallLaunchdSync(label = DEFAULT_CALENDAR_SYNC_LABEL) {
  return Effect.gen(function* () {
    assertDarwin();
    const targetPlist = plistPath(label);
    const uid = currentUid();
    try {
      launchctl(["bootout", `gui/${uid}`, targetPlist]);
    } catch {
      // Best effort.
    }
    yield* effectSync(`remove ${targetPlist}`, () => {
      if (fs.existsSync(targetPlist)) fs.unlinkSync(targetPlist);
    });
    console.log(`Removed ${label}`);
  });
}

export function statusLaunchdSync(label = DEFAULT_CALENDAR_SYNC_LABEL) {
  return Effect.gen(function* () {
    assertDarwin();
    const targetPlist = plistPath(label);
    const uid = currentUid();
    console.log(`label: ${label}`);
    console.log(`plist: ${targetPlist}`);
    console.log(`plist exists: ${fs.existsSync(targetPlist) ? "yes" : "no"}`);
    try {
      const output = launchctlRead(["print", `gui/${uid}/${label}`]);
      console.log(summarizeLaunchctlPrint(output));
      const state = extractLaunchctlField(output, "state =");
      const lastExitCode = extractLaunchctlField(output, "last exit code =");
      if (state === "not running" && lastExitCode === "0") {
        console.log("note: interval sync agents are normally idle between runs.");
      } else if (lastExitCode && lastExitCode !== "0") {
        console.log(`note: last recorded launchd exit was non-zero (${lastExitCode}).`);
      }
    } catch {
      console.log("launchctl: not loaded");
    }
  });
}
