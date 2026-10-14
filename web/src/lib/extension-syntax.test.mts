import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("Chrome Extension Syntax & Integrity", () => {
  const extensionDir = path.resolve(process.cwd(), "../extension");

  it("manifest.json is valid MV3 specification", () => {
    const manifestPath = path.join(extensionDir, "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "manifest.json must exist");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.name.includes("QuantsPulse"));
    assert.ok(manifest.side_panel?.default_path);
  });

  const jsFiles = [
    "background.js",
    "sidepanel/sidepanel.js",
    "content-scripts/detector.js",
    "content-scripts/auth-sync.js",
  ];

  for (const relPath of jsFiles) {
    it(`validates JS syntax for ${relPath} without compile errors`, () => {
      const fullPath = path.join(extensionDir, relPath);
      assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);

      // Execute node -c (syntax check only, no runtime execution)
      const output = execFileSync(process.execPath, ["-c", fullPath], {
        encoding: "utf-8",
      });
      assert.equal(output.trim(), "");
    });
  }
});
