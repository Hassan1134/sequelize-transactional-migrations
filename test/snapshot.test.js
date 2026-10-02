"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { recoverPending, saveMigration } = require("../lib/snapshot");

test("migration and snapshot are saved together", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-snapshot-"));
  try {
    fs.writeFileSync(path.join(dir, "_current.json"), "old");
    saveMigration(dir, "2-next.js", "migration source", "new");
    assert.equal(fs.readFileSync(path.join(dir, "2-next.js"), "utf8"), "migration source");
    assert.equal(fs.readFileSync(path.join(dir, "_current.json"), "utf8"), "new");
    assert.equal(fs.readFileSync(path.join(dir, "_current_bak.json"), "utf8"), "old");
    assert.equal(fs.existsSync(path.join(dir, "_current.pending.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted generation removes its migration and retains the previous snapshot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-snapshot-"));
  try {
    fs.writeFileSync(path.join(dir, "_current.json"), "old");
    fs.writeFileSync(path.join(dir, "3-next.js"), "migration source");
    fs.writeFileSync(path.join(dir, "_current.pending.json"), JSON.stringify({
      filename: "3-next.js", source: "migration source", previousSnapshot: "old",
      nextSnapshot: "new", tempName: "_current.1234.next.json",
    }));
    recoverPending(dir);
    assert.equal(fs.existsSync(path.join(dir, "3-next.js")), false);
    assert.equal(fs.readFileSync(path.join(dir, "_current.json"), "utf8"), "old");
    assert.equal(fs.existsSync(path.join(dir, "_current.pending.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recovery refuses to overwrite a migration changed after interruption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-snapshot-"));
  try {
    fs.writeFileSync(path.join(dir, "_current.json"), "old");
    fs.writeFileSync(path.join(dir, "3-next.js"), "edited migration");
    fs.writeFileSync(path.join(dir, "_current.pending.json"), JSON.stringify({
      filename: "3-next.js", source: "migration source", previousSnapshot: "old",
      nextSnapshot: "new", tempName: "_current.1234.next.json",
    }));
    assert.throws(() => recoverPending(dir), /files have changed/);
    assert.equal(fs.readFileSync(path.join(dir, "3-next.js"), "utf8"), "edited migration");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recovery accepts a completed snapshot update after interruption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-snapshot-"));
  try {
    fs.writeFileSync(path.join(dir, "_current.json"), "new");
    fs.writeFileSync(path.join(dir, "3-next.js"), "migration source");
    fs.writeFileSync(path.join(dir, "_current.pending.json"), JSON.stringify({
      filename: "3-next.js", source: "migration source", previousSnapshot: "old",
      nextSnapshot: "new", tempName: "_current.1234.next.json",
    }));
    recoverPending(dir);
    assert.equal(fs.readFileSync(path.join(dir, "3-next.js"), "utf8"), "migration source");
    assert.equal(fs.existsSync(path.join(dir, "_current.pending.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
