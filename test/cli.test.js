"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function run(bin, args, cwd) {
  const result = spawnSync(process.execPath, [path.join(root, "bin", bin), ...args], {
    cwd, encoding: "utf8", timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}

test("both CLI help commands work outside a Sequelize application", () => {
  for (const bin of ["make.js", "undo.js"]) {
    assert.match(run(bin, ["--help"], os.tmpdir()), /Usage:/);
  }
});

test("standalone CLI previews, generates, and reuses a snapshot with consumer paths", () => {
  const fixture = fs.mkdtempSync(path.join(root, ".fixture-"));
  try {
    fs.mkdirSync(path.join(fixture, "models"));
    fs.writeFileSync(path.join(fixture, "package.json"), '{}');
    const modelSource = (type, nullable) => `
      const Sequelize = require('sequelize');
      const sequelize = new Sequelize('postgres://test:test@localhost/test', {logging:false});
      const Staff = sequelize.define('staff', {
        state: {type: Sequelize.ENUM('pending', "owner's"), allowNull: false},
        code: {type: Sequelize.${type}, allowNull: ${nullable}}
      });
      module.exports = {sequelize, Sequelize, Staff};
    `;
    fs.writeFileSync(path.join(fixture, "models", "index.js"), modelSource("STRING", false));
    const args = ["--cwd", fixture, "--name", "create_staff"];
    assert.match(run("make.js", [...args, "--preview"], os.tmpdir()), /createTable/);
    assert.equal(fs.existsSync(path.join(fixture, "migrations", "_current.json")), false);
    assert.match(run("make.js", args, os.tmpdir()), /Created transactional migration/);
    assert.match(run("make.js", args, os.tmpdir()), /No changes found/);
    fs.writeFileSync(path.join(fixture, "models", "index.js"), modelSource("INTEGER", true));
    const preview = run("make.js", [...args, "--preview"], os.tmpdir());
    assert.match(preview, /fn: "changeExistingColumn"/);
    assert.match(preview, /Sequelize.INTEGER/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
