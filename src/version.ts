import fs from "node:fs";
import path from "node:path";

interface PackageMetadata {
  name?: string;
  version?: string;
}

interface BuildMetadata {
  version?: string;
  revision?: string;
  dirty?: boolean;
  source?: string;
}

export interface VersionInfo {
  name: string;
  packageVersion: string;
  buildVersion?: string;
  revision?: string;
  dirty?: boolean;
  source?: string;
}

function readJsonFile<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function getVersionInfo(projectRoot: string): VersionInfo {
  const packageMetadata = readJsonFile<PackageMetadata>(path.join(projectRoot, "package.json")) ?? {};
  const buildMetadata = readJsonFile<BuildMetadata>(path.join(projectRoot, "build-info.json")) ?? {};

  return {
    name: packageMetadata.name ?? "linear-gsuite",
    packageVersion: packageMetadata.version ?? "0.0.0",
    buildVersion: buildMetadata.version,
    revision: buildMetadata.revision,
    dirty: buildMetadata.dirty,
    source: buildMetadata.source
  };
}

export function formatVersionInfo(info: VersionInfo) {
  const lines = [`${info.name} ${info.packageVersion}`];
  if (info.buildVersion) lines.push(`build: ${info.buildVersion}`);
  if (info.revision) lines.push(`revision: ${info.revision}${info.dirty ? " (dirty)" : ""}`);
  if (info.source) lines.push(`source: ${info.source}`);
  return lines.join("\n");
}
