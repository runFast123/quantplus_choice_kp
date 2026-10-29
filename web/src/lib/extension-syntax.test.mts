import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";

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

  it("the downloadable zip matches the source and uses portable paths", () => {
    // Each zip entry's local header holds the stored name; inflate the manifest to compare versions.
    const zip = fs.readFileSync(path.resolve(process.cwd(), "public/downloads/quantspulse-terminal.zip"));
    const entries = new Map<string, Buffer>();
    for (let i = zip.indexOf("PK\x03\x04"); i !== -1; i = zip.indexOf("PK\x03\x04", i + 4)) {
      const method = zip.readUInt16LE(i + 8);
      const size = zip.readUInt32LE(i + 18);
      const nameLen = zip.readUInt16LE(i + 26);
      const extraLen = zip.readUInt16LE(i + 28);
      const name = zip.toString("utf8", i + 30, i + 30 + nameLen);
      const data = zip.subarray(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + size);
      entries.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
    }
    // Backslash names unpack as flat files on macOS/Linux, and the extension won't load.
    for (const name of entries.keys()) assert.ok(!name.includes("\\"), `zip entry uses a backslash: ${name}`);
    for (const rel of ["manifest.json", ...jsFiles, "sidepanel/sidepanel.html", "sidepanel/sidepanel.css"]) {
      const packed = entries.get(rel);
      assert.ok(packed, `zip is missing ${rel}`);
      // Compare text with LF endings: git checks these files out as CRLF on Windows (core.autocrlf).
      const lf = (b: Buffer) => b.toString("utf8").replace(/\r\n/g, "\n");
      assert.equal(lf(packed), lf(fs.readFileSync(path.join(extensionDir, rel))), `zip has a stale ${rel}: repackage the extension`);
    }
  });
});
