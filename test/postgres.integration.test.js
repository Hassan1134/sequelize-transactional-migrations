"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Sequelize = require("sequelize");

const root = path.resolve(__dirname, "..");
const databaseUrl = process.env.TEST_DATABASE_URL;

function run(script, args, cwd, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, env: process.env, encoding: "utf8", timeout: 120000,
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout || String(result.error));
  return result.stdout + result.stderr;
}

test("PostgreSQL applies, rolls back failure, and undoes a generated migration", {
  skip: !databaseUrl && "Set TEST_DATABASE_URL to run PostgreSQL integration tests",
  timeout: 360000,
}, async () => {
  const fixture = fs.mkdtempSync(path.join(root, ".integration-"));
  const suffix = path.basename(fixture).replace(/[^a-zA-Z0-9]/g, "");
  const table = `migration_items_${suffix}`;
  const meta = `SequelizeMeta_${suffix}`;
  const sequelize = new Sequelize(databaseUrl, { logging: false });
  const migrations = path.join(fixture, "migrations");
  const models = path.join(fixture, "models");
  const config = path.join(fixture, "config.js");
  const make = path.join(root, "bin", "make.js");
  const cliPackage = require("sequelize-cli/package.json");
  const cliBin = typeof cliPackage.bin === "string"
    ? cliPackage.bin : cliPackage.bin.sequelize || cliPackage.bin["sequelize-cli"];
  const cli = path.resolve(path.dirname(require.resolve("sequelize-cli/package.json")), cliBin);
  const makeArgs = ["--cwd", fixture, "--models-path", models, "--migrations-path", migrations];
  const migrateArgs = ["db:migrate", "--env", "test", "--config", config, "--migrations-path", migrations];
  const writeModel = (codeType, extraFields = "", unique = true) => {
    fs.writeFileSync(path.join(models, "index.js"), `
      const Sequelize = require("sequelize");
      const sequelize = new Sequelize(process.env.TEST_DATABASE_URL, { logging: false });
      const Item = sequelize.define("Item", {
        code: { type: Sequelize.${codeType}, allowNull: false },
        ${extraFields}
      }, {
        tableName: ${JSON.stringify(table)},
        indexes: [{ name: ${JSON.stringify(table + "_code_idx")}, fields: ["code"], unique: ${unique} }]
      });
      module.exports = { sequelize, Sequelize, Item };
    `);
  };
  try {
    fs.mkdirSync(models);
    fs.writeFileSync(path.join(fixture, "package.json"), '{"type":"commonjs"}');
    fs.writeFileSync(config, `module.exports = { test: {
      use_env_variable: "TEST_DATABASE_URL", dialect: "postgres",
      migrationStorageTableName: ${JSON.stringify(meta)}, logging: false
    } };`);
    writeModel("STRING");
    run(make, [...makeArgs, "--name", "initial"], fixture);
    run(cli, migrateArgs, fixture);
    let columns = await sequelize.getQueryInterface().describeTable(table);
    assert.ok(columns.code);
    await sequelize.query(`INSERT INTO "${table}" ("code", "createdAt", "updatedAt") VALUES ('7', NOW(), NOW())`);

    writeModel("INTEGER", "note: { type: Sequelize.STRING },", false);
    run(make, [...makeArgs, "--name", "alter"], fixture);
    run(cli, migrateArgs, fixture);
    columns = await sequelize.getQueryInterface().describeTable(table);
    assert.equal(columns.code.type, "INTEGER");
    assert.ok(columns.note);
    const indexRows = await sequelize.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename = :table AND indexname = :name",
      { replacements: { table, name: table + "_code_idx" }, type: Sequelize.QueryTypes.SELECT },
    );
    assert.doesNotMatch(indexRows[0].indexdef, /CREATE UNIQUE INDEX/);

    writeModel("INTEGER", `note: { type: Sequelize.STRING },
      safe: { type: Sequelize.STRING },
      required: { type: Sequelize.STRING, allowNull: false },`, false);
    run(make, [...makeArgs, "--name", "must_fail"], fixture);
    run(cli, migrateArgs, fixture, 1);
    columns = await sequelize.getQueryInterface().describeTable(table);
    assert.equal(columns.safe, undefined);
    assert.equal(columns.required, undefined);
    const applied = await sequelize.query(`SELECT "name" FROM "${meta}" ORDER BY "name"`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    assert.deepEqual(applied.map((row) => row.name), ["1-initial.js", "2-alter.js"]);

    run(path.join(root, "bin", "undo.js"), [
      "--cwd", fixture, "--env", "test", "--config", config,
      "--migrations-path", migrations,
    ], fixture);
    columns = await sequelize.getQueryInterface().describeTable(table);
    assert.match(columns.code.type, /CHARACTER VARYING/);
    assert.equal(columns.note, undefined);
    const restoredIndex = await sequelize.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename = :table AND indexname = :name",
      { replacements: { table, name: table + "_code_idx" }, type: Sequelize.QueryTypes.SELECT },
    );
    assert.match(restoredIndex[0].indexdef, /CREATE UNIQUE INDEX/);
    const remaining = await sequelize.query(`SELECT "name" FROM "${meta}"`, {
      type: Sequelize.QueryTypes.SELECT,
    });
    assert.deepEqual(remaining.map((row) => row.name), ["1-initial.js"]);
  } finally {
    await sequelize.getQueryInterface().dropTable(table).catch(() => {});
    await sequelize.getQueryInterface().dropTable(meta).catch(() => {});
    await sequelize.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
