"use strict";

const fs = require("fs");
const path = require("path");
const { parseArgs } = require("node:util");
const { Script } = require("node:vm");
const migrate = require("./vendor/migrate");
const { isDeepStrictEqual } = require("node:util");
const { project, assertCompatible, pathOptions } = require("./project");

// Embedded in generated files so their behavior does not change with this script.
async function changeExistingColumn(queryInterface, table, column, definition, previousType, transaction) {
  const sequelize = queryInterface.sequelize;
  const generator = queryInterface.queryGenerator || queryInterface.QueryGenerator;
  const target = sequelize.normalizeAttribute(definition).type;
  const source = sequelize.normalizeAttribute({ type: previousType }).type;
  const isEnum = (type) => type.key === "ENUM";
  const typeChanged = target.toString() !== source.toString() ||
    JSON.stringify(target.values) !== JSON.stringify(source.values);
  if (sequelize.getDialect() !== "postgres") {
    throw new Error("Existing-column migrations require PostgreSQL.");
  }
  const tableSql = generator.quoteTable(table);
  const columnSql = generator.quoteIdentifier(column);
  const alter = "ALTER TABLE " + tableSql + " ALTER COLUMN " + columnSql;
  const execute = (sql) => sequelize.query(sql, { transaction });
  if (typeChanged) {
    // Defaults can depend on the old enum/type and must be restored after conversion.
    await execute(alter + " DROP DEFAULT;");
    let oldEnum;
    if (isEnum(source)) {
      const temporaryName = "migration_enum_" + require("node:crypto")
        .createHash("sha256").update(JSON.stringify([table, column])).digest("hex").slice(0, 24);
      const details = generator.extractTableDetails(table);
      oldEnum = generator.quoteIdentifier(details.schema) + "." + generator.quoteIdentifier(temporaryName);
      await execute("ALTER TYPE " + generator.pgEnumName(table, column) +
        " RENAME TO " + generator.quoteIdentifier(temporaryName) + ";");
    }
    if (isEnum(target)) {
      await execute(generator.pgEnum(table, column, target));
    }
    const typeSql = isEnum(target) ? generator.pgEnumName(table, column) : target.toString();
    const valueSql = isEnum(source) || isEnum(target) ? columnSql + "::text" : columnSql;
    await execute(alter + " TYPE " + typeSql + " USING (" + valueSql + "::" + typeSql + ");");
    if (oldEnum) await execute("DROP TYPE " + oldEnum + ";");
  }
  // Explicitly handle nullability even for reference columns (Sequelize skips it there).
  await execute(alter + (definition.allowNull === false ? " SET NOT NULL;" : " DROP NOT NULL;"));
  await queryInterface.changeColumn(table, column, definition, { transaction });
}

function migrationCommands(previous, current) {
  const actions = migrate.parseDifference(previous, current)
    .filter((action) => action.actionType !== "changeColumn");
  for (const [table, target] of Object.entries(current)) {
    for (const [attribute, definition] of Object.entries(target.schema)) {
      const old = previous[table]?.schema[attribute];
      if (!old || isDeepStrictEqual(old, definition)) continue;
      actions.push({
        actionType: "changeColumn", tableName: table, attributeName: attribute,
        options: { ...definition, allowNull: definition.allowNull ?? true },
        previousType: old.seqType, depends: [table],
      });
    }
  }
  migrate.sortActions(actions);
  return actions.map((action) => {
    const command = migrate.getMigration([action]).commandsUp[0];
    if (action.actionType !== "changeColumn") return command;
    return command.replace('fn: "changeColumn"', 'fn: "changeExistingColumn"')
      .replace(/\]\s*\}$/, ", " + action.previousType + "] }");
  });
}

function renderMigration(previousTables, currentTables, info) {
  const up = migrationCommands(previousTables, currentTables);
  const down = migrationCommands(currentTables, previousTables);
  if (!up.length) return null;

  return `"use strict";

const Sequelize = require("sequelize");

// Review both directions before running, especially destructive or enum changes.
const upCommands = [
${up.join(",\n")}
];
const downCommands = [
${down.join(",\n")}
];

// QueryInterface methods have different positions for their options argument.
const optionsPositions = {
  createTable: 2,
  dropTable: 1,
  addColumn: 3,
  removeColumn: 2,
  changeColumn: 3,
  addIndex: 2,
  removeIndex: 2,
};

${changeExistingColumn.toString()}

async function runCommands(queryInterface, commands) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    for (const command of commands) {
      if (command.fn === "changeExistingColumn") {
        await changeExistingColumn(queryInterface, ...command.params, transaction);
        continue;
      }
      const optionsPosition = optionsPositions[command.fn];
      if (optionsPosition === undefined) {
        throw new Error("Unsupported migration command: " + command.fn);
      }
      const params = [...command.params];
      params[optionsPosition] = { ...params[optionsPosition], transaction };
      await queryInterface[command.fn](...params);
    }
  });
}

module.exports = {
  up(queryInterface) {
    return runCommands(queryInterface, upCommands);
  },
  down(queryInterface) {
    return runCommands(queryInterface, downCommands);
  },
  info: ${JSON.stringify(info, null, 2)},
};
`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      ...pathOptions,
      name: { type: "string", short: "n", default: "noname" },
      comment: { type: "string", short: "c", default: "" },
      preview: { type: "boolean", short: "p" },
      help: { type: "boolean" },
      execute: { type: "boolean", short: "x" },
      "models-path": { type: "string" },
      "migrations-path": { type: "string" },
    },
  });
  if (values.help) {
    console.log("Usage: sequelize-make-migration --name migration_name [--preview] [--cwd project] [--sequelizerc file] [--models-path path] [--migrations-path path]");
    console.log("Generates transactional up/down methods. Run separately with npm run db:migrate:local (or staging/production).");
    return;
  }
  if (values.execute) {
    throw new Error("Generate and review first, then use db:migrate:local (or staging/production) so SequelizeMeta tracks execution. --execute is not supported.");
  }
  const name = values.name.trim().replace(/\s+/g, "_");
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Migration name must contain only letters, numbers, underscores or hyphens.");
  }

  const settings = project(values);
  assertCompatible(settings.projectRequire);
  const modelsDir = settings.models;
  const migrationsDir = settings.migrations;
  fs.mkdirSync(migrationsDir, { recursive: true });
  const statePath = path.join(migrationsDir, "_current.json");
  const previousSource = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : null;
  // A missing snapshot is safe only for a new migration directory.
  if (!previousSource && fs.readdirSync(migrationsDir).some((file) => /\.(js|cjs)$/.test(file))) {
    throw new Error("Missing _current.json beside existing migrations. Restore the generator snapshot before generating another migration.");
  }
  const previous = previousSource ? JSON.parse(previousSource) : { revision: 0, tables: {} };
  if (!Number.isInteger(previous.revision) || previous.revision < 0 || !previous.tables || typeof previous.tables !== "object" || Array.isArray(previous.tables)) {
    throw new Error("Invalid migration snapshot. Restore _current.json before generating another migration.");
  }

  const db = require(modelsDir);
  try {
    if ((db.sequelize || db).getDialect() !== "postgres") {
      throw new Error("Transactional model migrations support PostgreSQL only.");
    }
    const models = { ...(db.models || db) };
    delete models.sequelize;
    delete models.Sequelize;
    // The dependency interpolates enum labels into single quotes without escaping.
    const enumTypes = [];
    for (const model of Object.values(models)) {
      for (const [attribute, definition] of Object.entries(model.rawAttributes || {})) {
        if (definition.type?.key === "ENUM") {
          enumTypes.push([model.tableName, attribute,
            "Sequelize.ENUM(" + definition.type.values.map((value) =>
              "'" + JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'") + "'"
            ).join(", ") + ")"]);
        }
      }
    }
    const tables = migrate.reverseModels(db, models);
    for (const [table, attribute, seqType] of enumTypes) {
      tables[table].schema[attribute].seqType = seqType;
    }
    const current = {
      revision: previous.revision + 1,
      tables,
    };
    const source = renderMigration(previous.tables, current.tables, {
      revision: current.revision,
      name,
      created: new Date().toISOString(),
      comment: values.comment,
    });
    if (!source) {
      console.log("No changes found");
      return;
    }
    new Script(source); // Reject invalid generated JavaScript before changing the snapshot.
    if (values.preview) {
      console.log(source);
      return;
    }
    const filename = path.join(migrationsDir, `${current.revision}-${name}.js`);
    if (fs.readdirSync(migrationsDir).some((file) => file.startsWith(`${current.revision}-`) || file === `${current.revision}.js`)) {
      throw new Error(`Migration revision ${current.revision} already exists. Check the snapshot before proceeding.`);
    }
    if (previousSource !== null) {
      fs.writeFileSync(path.join(migrationsDir, "_current_bak.json"), previousSource);
    }
    fs.writeFileSync(filename, source, { flag: "wx" });
    fs.writeFileSync(statePath, JSON.stringify(current, null, 4));
    console.log(`Created transactional migration: ${filename}`);
    console.log("Review up/down, then run the environment-specific db:migrate command.");
  } finally {
    await (db.sequelize || db).close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { renderMigration, main };
