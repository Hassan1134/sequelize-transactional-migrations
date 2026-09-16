"use strict";

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("node:util");
const { spawnSync } = require("node:child_process");
const { project, assertCompatible, pathOptions } = require("./project");

function selectLatestMigration(names) {
  let latest = null;
  let latestCount = 0;
  for (const name of names) {
    const match = /^(\d+)(?:[-_][a-zA-Z0-9_-]+)?\.(?:js|cjs)$/.exec(name);
    if (!match) {
      throw new Error(`Cannot determine numeric migration order for ${name}. Use db:down:specific with an explicit filename.`);
    }
    const revision = BigInt(match[1]);
    if (!latest || revision > latest.revision) {
      latest = { revision, name };
      latestCount = 1;
    } else if (revision === latest.revision) {
      latestCount++;
    }
  }
  if (latestCount > 1) {
    throw new Error(`Multiple applied migrations have revision ${latest.revision}. Use db:down:specific with an explicit filename.`);
  }
  return latest ? latest.name : null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      ...pathOptions,
      "dry-run": { type: "boolean" },
      env: { type: "string", default: process.env.NODE_ENV || "development" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log("Usage: sequelize-undo-last-migration [--dry-run] [--env environment] [--cwd project] [--config file] [--migrations-path path]");
    console.log("Selects the highest applied numeric revision from SequelizeMeta, then undoes only that migration.");
    return;
  }
  process.env.NODE_ENV = values.env;
  const settings = project(values);
  assertCompatible(settings.projectRequire);
  const { Sequelize, QueryTypes } = settings.projectRequire("sequelize");
  const configPath = settings.config;
  const config = require(configPath)[values.env];
  if (!config) throw new Error(`Unknown database environment: ${values.env}`);
  if (config.migrationStorage && config.migrationStorage !== "sequelize") {
    throw new Error("Numeric rollback requires Sequelize migration storage.");
  }
  const sequelize = config.use_env_variable
    ? new Sequelize(process.env[config.use_env_variable], { ...config, logging: false })
    : new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  let target;
  try {
    const qi = sequelize.getQueryInterface();
    const generator = qi.queryGenerator || qi.QueryGenerator;
    const table = generator.quoteTable({
      tableName: config.migrationStorageTableName || "SequelizeMeta",
      schema: config.migrationStorageTableSchema,
    });
    // Read metadata directly: unlike Umzug.executed(), this does not sync a table.
    const rows = await sequelize.query(`SELECT ${generator.quoteIdentifier("name")} FROM ${table}`, {
      type: QueryTypes.SELECT,
    });
    target = selectLatestMigration(rows.map((row) => row.name));
  } finally {
    await sequelize.close();
  }
  if (!target) {
    console.log("No executed migrations found.");
    return;
  }
  const migrationsPath = settings.migrations;
  const filename = path.join(migrationsPath, target);
  if (!fs.existsSync(filename)) {
    throw new Error(`Latest applied migration file is missing: ${target}. Restore it before undoing.`);
  }
  const migration = require(filename);
  if (typeof migration.down !== "function") {
    throw new Error(`Latest applied migration ${target} has no down method. Add a reviewed rollback before undoing it.`);
  }
  console.log(`Rollback target (${values.env}): ${target}`);
  if (values["dry-run"]) return;

  const result = spawnSync(process.execPath, [
    settings.projectRequire.resolve("sequelize-cli/lib/sequelize"),
    "db:migrate:undo", "--env", values.env,
    "--config", configPath, "--migrations-path", migrationsPath,
    "--name", target,
  ], { stdio: "inherit", env: process.env, cwd: settings.root });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { selectLatestMigration, main };
