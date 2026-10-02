"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function contents(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function recoverPending(migrationsDir) {
  const pendingPath = path.join(migrationsDir, "_current.pending.json");
  if (!fs.existsSync(pendingPath)) return;
  const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  if (!/^\d+-[a-zA-Z0-9_-]+\.js$/.test(pending.filename) ||
      !/^_current\.[a-f0-9-]+\.next\.json$/.test(pending.tempName)) {
    throw new Error("Invalid pending migration record. Inspect _current.pending.json before generating again.");
  }
  const migrationPath = path.join(migrationsDir, pending.filename);
  const statePath = path.join(migrationsDir, "_current.json");
  const tempPath = path.join(migrationsDir, pending.tempName);
  const state = contents(statePath);
  const migration = contents(migrationPath);
  if (state === pending.nextSnapshot && migration === pending.source) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    fs.unlinkSync(pendingPath);
    return;
  }
  if (state === pending.previousSnapshot &&
      (migration === null || migration === pending.source)) {
    if (migration !== null) fs.unlinkSync(migrationPath);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    fs.unlinkSync(pendingPath);
    return;
  }
  throw new Error("Migration generation was interrupted and files have changed. Inspect _current.pending.json before generating again.");
}

function saveMigration(migrationsDir, filename, source, nextSnapshot) {
  recoverPending(migrationsDir);
  const statePath = path.join(migrationsDir, "_current.json");
  const previousSnapshot = contents(statePath);
  const migrationPath = path.join(migrationsDir, filename);
  if (fs.existsSync(migrationPath)) throw new Error(`Migration already exists: ${filename}`);
  if (previousSnapshot !== null) {
    fs.writeFileSync(path.join(migrationsDir, "_current_bak.json"), previousSnapshot);
  }
  const pendingPath = path.join(migrationsDir, "_current.pending.json");
  const tempName = `_current.${randomUUID()}.next.json`;
  const pending = { filename, source, previousSnapshot, nextSnapshot, tempName };
  fs.writeFileSync(pendingPath, JSON.stringify(pending), { flag: "wx" });
  try {
    fs.writeFileSync(migrationPath, source, { flag: "wx" });
    fs.writeFileSync(path.join(migrationsDir, tempName), nextSnapshot, { flag: "wx" });
    fs.renameSync(path.join(migrationsDir, tempName), statePath);
    fs.unlinkSync(pendingPath);
  } catch (error) {
    recoverPending(migrationsDir);
    throw error;
  }
}

module.exports = { recoverPending, saveMigration };
