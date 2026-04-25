import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatEnvironmentRequirementStatus,
  hydrateEnvironmentRequirement,
  hydrateProcessEnvFromFiles,
  inspectEnvironmentRequirement
} from "../src/utils.js";

describe("environment file hydration", () => {
  it("loads NAME_FILE contents into NAME without keeping trailing newlines", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-env-"));
    const secretFile = path.join(tempDir, "linear-api-key");
    fs.writeFileSync(secretFile, "lin_api_test_value\n");

    const env: NodeJS.ProcessEnv = {
      LINEAR_API_KEY_FILE: secretFile
    };

    hydrateProcessEnvFromFiles(env);

    expect(env.LINEAR_API_KEY).toBe("lin_api_test_value");
    expect(env.LINEAR_API_KEY_FILE).toBe(secretFile);
  });

  it("does not overwrite an already-set environment variable", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-env-"));
    const secretFile = path.join(tempDir, "linear-api-key");
    fs.writeFileSync(secretFile, "lin_api_from_file\n");

    const env: NodeJS.ProcessEnv = {
      LINEAR_API_KEY: "lin_api_existing",
      LINEAR_API_KEY_FILE: secretFile
    };

    hydrateProcessEnvFromFiles(env);

    expect(env.LINEAR_API_KEY).toBe("lin_api_existing");
  });

  it("can hydrate one named requirement from NAME_FILE", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-env-"));
    const secretFile = path.join(tempDir, "linear-api-key");
    fs.writeFileSync(secretFile, "lin_api_targeted\n");

    const env: NodeJS.ProcessEnv = {
      LINEAR_API_KEY_FILE: secretFile
    };

    hydrateEnvironmentRequirement("LINEAR_API_KEY", env);

    expect(env.LINEAR_API_KEY).toBe("lin_api_targeted");
  });

  it("describes missing and file-backed requirements without exposing values", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-env-"));
    const secretFile = path.join(tempDir, "linear-api-key");
    fs.writeFileSync(secretFile, "lin_api_hidden\n");

    const missing = formatEnvironmentRequirementStatus(
      inspectEnvironmentRequirement("LINEAR_API_KEY", {})
    );
    const fileBacked = formatEnvironmentRequirementStatus(
      inspectEnvironmentRequirement("LINEAR_API_KEY", {
        LINEAR_API_KEY_FILE: secretFile
      })
    );

    expect(missing).toBe("LINEAR_API_KEY: missing; LINEAR_API_KEY_FILE: missing");
    expect(fileBacked).toBe(`LINEAR_API_KEY: available via LINEAR_API_KEY_FILE=${secretFile} (readable)`);
    expect(fileBacked).not.toContain("lin_api_hidden");
  });
});
