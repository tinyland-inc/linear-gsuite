import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatVersionInfo, getVersionInfo } from "../src/version.js";

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

describe("version metadata", () => {
  it("reports package and build identity without requiring git", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-gsuite-version-"));
    writeJson(path.join(tempDir, "package.json"), {
      name: "@tummycrypt/linear-gsuite",
      version: "0.1.0"
    });
    writeJson(path.join(tempDir, "build-info.json"), {
      version: "0.1.0-dev+abc1234",
      revision: "abc1234",
      dirty: true,
      source: "nix"
    });

    const output = formatVersionInfo(getVersionInfo(tempDir));

    expect(output).toContain("@tummycrypt/linear-gsuite 0.1.0");
    expect(output).toContain("build: 0.1.0-dev+abc1234");
    expect(output).toContain("revision: abc1234 (dirty)");
    expect(output).toContain("source: nix");
  });
});
