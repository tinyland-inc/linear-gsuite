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

