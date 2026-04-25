import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";

export class CliError extends Error {
  readonly _tag = "CliError";

  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function fail(message: string): CliError {
  return new CliError(message);
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function effectSync<A>(label: string, thunk: () => A) {
  return Effect.try({
    try: thunk,
    catch: (error) => fail(`${label}: ${toMessage(error)}`)
  });
}

export function effectPromise<A>(label: string, thunk: () => Promise<A>) {
  return Effect.tryPromise({
    try: thunk,
    catch: (error) => fail(`${label}: ${toMessage(error)}`)
  });
}

export function expandHome(file: string): string {
  if (file.startsWith("~/")) return path.join(os.homedir(), file.slice(2));
  return file;
}

export function fileExists(file: string): boolean {
  return fs.existsSync(expandHome(file));
}

export function ensureParentDir(file: string) {
  fs.mkdirSync(path.dirname(expandHome(file)), { recursive: true });
}

export function resolveFromCwd(file: string, cwd = process.cwd()): string {
  const expanded = expandHome(file);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(cwd, expanded);
}

export function resolveRelativeTo(file: string, baseDir: string): string {
  const expanded = expandHome(file);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(baseDir, expanded);
}

export function readJsonUnknown(file: string) {
  return effectSync(`read ${file}`, () => JSON.parse(fs.readFileSync(expandHome(file), "utf8")) as unknown);
}

export function readJsonIfExists(file: string, fallback: unknown) {
  return fileExists(file) ? readJsonUnknown(file) : Effect.succeed(fallback);
}

export function writeJsonFile(file: string, value: unknown, mode = 0o600) {
  return effectSync(`write ${file}`, () => {
    ensureParentDir(file);
    fs.writeFileSync(expandHome(file), `${JSON.stringify(value, null, 2)}\n`, { mode });
    try {
      fs.chmodSync(expandHome(file), mode);
    } catch {
      // Best effort on platforms that ignore chmod here.
    }
  });
}

export function writeTextFile(file: string, text: string) {
  return effectSync(`write ${file}`, () => {
    ensureParentDir(file);
    fs.writeFileSync(expandHome(file), text);
  });
}

export function removeFileIfExists(file: string) {
  return effectSync(`remove ${file}`, () => {
    const target = expandHome(file);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  });
}

export function discoverProjectRoot(currentFile: string): string {
  return path.resolve(path.dirname(currentFile), "..");
}

function trimTrailingLineEndings(value: string) {
  return value.replace(/[\r\n]+$/, "");
}

export interface EnvironmentRequirementStatus {
  name: string;
  valueSet: boolean;
  fileVariable: string;
  file?: string;
  fileExists: boolean;
  fileReadable: boolean;
}

export function inspectEnvironmentRequirement(name: string, env: NodeJS.ProcessEnv = process.env): EnvironmentRequirementStatus {
  const fileVariable = `${name}_FILE`;
  const file = env[fileVariable];
  let fileExists = false;
  let fileReadable = false;

  if (file) {
    const resolved = expandHome(file);
    fileExists = fs.existsSync(resolved);
    if (fileExists) {
      try {
        fs.accessSync(resolved, fs.constants.R_OK);
        fileReadable = true;
      } catch {
        fileReadable = false;
      }
    }
  }

  return {
    name,
    valueSet: Boolean(env[name]),
    fileVariable,
    file,
    fileExists,
    fileReadable
  };
}

export function formatEnvironmentRequirementStatus(status: EnvironmentRequirementStatus) {
  if (status.valueSet && status.file) {
    const fileState = status.fileReadable ? "readable" : status.fileExists ? "unreadable" : "missing";
    return `${status.name}: set; ${status.fileVariable}=${status.file} (${fileState})`;
  }
  if (status.valueSet) return `${status.name}: set`;
  if (status.file) {
    if (status.fileReadable) return `${status.name}: available via ${status.fileVariable}=${status.file} (readable)`;
    const fileState = status.fileExists ? "unreadable" : "missing";
    return `${status.name}: missing; ${status.fileVariable}=${status.file} (${fileState})`;
  }
  return `${status.name}: missing; ${status.fileVariable}: missing`;
}

export function hydrateEnvironmentRequirement(name: string, env: NodeJS.ProcessEnv = process.env) {
  if (!name || env[name]) return;
  const file = env[`${name}_FILE`];
  if (!file) return;
  const resolved = expandHome(file);
  if (!fs.existsSync(resolved)) {
    throw fail(`Environment file for ${name} not found: ${file}`);
  }
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw fail(`Environment file for ${name} is not readable: ${file}`);
  }
  env[name] = trimTrailingLineEndings(fs.readFileSync(resolved, "utf8"));
}

export function hydrateProcessEnvFromFiles(env: NodeJS.ProcessEnv = process.env) {
  for (const [name, file] of Object.entries(env)) {
    if (!name.endsWith("_FILE") || !file) continue;
    const targetName = name.slice(0, -5);
    hydrateEnvironmentRequirement(targetName, env);
  }
}
