"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { renderMigration } = require("../lib/make-migration");
const Sequelize = require("sequelize");
const dialect = new Sequelize("postgres://test:test@localhost/test", { logging: false });

const before = {
  staff: {
    tableName: "staff",
    schema: { id: { seqType: "Sequelize.INTEGER", allowNull: false } },
    indexes: {},
  },
};
const after = structuredClone(before);
after.staff.schema.email = { seqType: "Sequelize.STRING", allowNull: true };
after.staff.schema.phone = { seqType: "Sequelize.STRING", allowNull: true };
after.staff.schema.bio = { seqType: "Sequelize.TEXT", allowNull: true };

function loadMigration(previous, current) {
  const context = { require, module: { exports: {} } };
  runInNewContext(renderMigration(previous, current, { revision: 1 }), context);
  return context.module.exports;
}

// Simulate only the transaction boundary; require every query to join it.
function database(failAt = -1) {
  const events = [];
  const calls = [];
  const committed = [];
  let active;
  const queryInterface = {
    queryGenerator: dialect.getQueryInterface().queryGenerator || dialect.getQueryInterface().QueryGenerator,
    sequelize: {
      normalizeAttribute: dialect.normalizeAttribute.bind(dialect),
      getDialect: () => "postgres",
      async query(sql, options) {
        assert.equal(options.transaction, active);
        calls.push({ method: "query", args: [sql, options] });
        if (calls.length === failAt) throw new Error("simulated database failure");
        active.pending.push(sql);
      },
      async transaction(callback) {
        const transaction = {};
        active = transaction;
        const pending = [];
        transaction.pending = pending;
        events.push("begin");
        try {
          await callback(transaction);
          committed.push(...pending);
          events.push("commit");
        } catch (error) {
          events.push("rollback");
          throw error;
        } finally {
          active = null;
        }
      },
    },
  };
  for (const method of ["createTable", "dropTable", "addColumn", "removeColumn", "changeColumn", "addIndex", "removeIndex"]) {
    queryInterface[method] = async (...args) => {
      assert.ok(active, "query must run inside a transaction");
      assert.equal(args.at(-1).transaction, active, `${method} must receive the transaction in its options`);
      calls.push({ method, args });
      events.push(method);
      await Promise.resolve();
      if (calls.length === failAt) throw new Error("simulated database failure");
      active.pending.push(method);
    };
  }
  return { queryInterface, events, calls, committed };
}

test("up and down commit after all sequential commands finish", async () => {
  const migration = loadMigration(before, after);
  for (const [direction, method] of [["up", "addColumn"], ["down", "removeColumn"]]) {
    const db = database();
    await migration[direction](db.queryInterface);
    assert.deepEqual(db.events, ["begin", method, method, method, "commit"]);
    assert.equal(db.committed.length, 3);
  }
});

test("a middle failure rolls back and skips remaining commands in either direction", async () => {
  const migration = loadMigration(before, after);
  for (const direction of ["up", "down"]) {
    const db = database(2);
    await assert.rejects(migration[direction](db.queryInterface), /simulated database failure/);
    assert.equal(db.calls.length, 2);
    assert.equal(db.events.at(-1), "rollback");
    assert.deepEqual(db.committed, []);
    // A retry must begin at the first command, not resume a partial migration.
    const retry = database();
    await migration[direction](retry.queryInterface);
    assert.equal(retry.calls.length, 3);
  }
});

test("table, index and column changes preserve options and receive transactions", async () => {
  const indexed = structuredClone(before);
  indexed.staff.indexes.staff_id_unique = {
    fields: ["id"], options: { name: "staff_id_unique", unique: true },
  };
  const created = loadMigration({}, indexed);
  const db = database();
  await created.up(db.queryInterface);
  assert.deepEqual(db.calls.map((call) => call.method), ["createTable", "addIndex"]);
  assert.equal(db.calls[1].args[2].unique, true);
  assert.equal(db.calls[1].args[2].name, "staff_id_unique");
  await created.down(db.queryInterface);
  assert.equal(db.calls.at(-1).method, "dropTable");

  const indexChange = loadMigration(before, indexed);
  await indexChange.down(db.queryInterface);
  assert.equal(db.calls.at(-1).method, "removeIndex");

  const nullable = structuredClone(before);
  nullable.staff.schema.id.allowNull = true;
  const columnChange = loadMigration(before, nullable);
  await columnChange.up(db.queryInterface);
  assert.equal(db.calls.at(-1).method, "changeColumn");
  assert.equal(db.calls.at(-1).args[2].allowNull, true);
  await columnChange.down(db.queryInterface);
  assert.equal(db.calls.at(-1).args[2].allowNull, false);
});

test("unchanged snapshots produce no migration", () => {
  assert.equal(renderMigration(before, structuredClone(before), { revision: 1 }), null);
});

test("identical index field arrays do not emit unsupported-array warnings", () => {
  const indexed = structuredClone(before);
  indexed.staff.indexes.staff_email = {
    fields: ["email"],
    options: { name: "staff_email" },
  };
  const warnings = [];
  const originalLog = console.log;
  console.log = (...values) => warnings.push(values.join(" "));
  try {
    assert.equal(renderMigration(indexed, structuredClone(indexed), { revision: 1 }), null);
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(warnings, []);
});

test("enum values, type and nullability change once per column in both directions", async () => {
  const old = structuredClone(before);
  old.staff.schema.state = {
    field: "staff_state", seqType: "Sequelize.ENUM('pending', 'active')",
    allowNull: false, defaultValue: { value: "pending" },
  };
  const next = structuredClone(old);
  next.staff.schema.state.seqType = "Sequelize.ENUM('pending', 'active', 'paused')";
  next.staff.schema.state.allowNull = true;
  next.staff.schema.state.defaultValue.value = "paused";
  const migration = loadMigration(old, next);
  for (const direction of ["up", "down"]) {
    const db = database();
    await migration[direction](db.queryInterface);
    assert.equal(db.calls.filter((call) => call.method === "changeColumn").length, 1);
    const sql = db.calls.filter((call) => call.method === "query").map((call) => call.args[0]).join("\n");
    assert.match(sql, /DROP DEFAULT/);
    assert.match(sql, /ALTER TYPE.*RENAME TO/);
    assert.match(sql, /CREATE TYPE/);
    assert.match(sql, /USING \("staff_state"::text::/);
    assert.match(sql, /DROP TYPE/);
    assert.match(sql, direction === "up" ? /DROP NOT NULL/ : /SET NOT NULL/);
    assert.equal(db.calls.at(-1).args[2].defaultValue, direction === "up" ? "paused" : "pending");
  }
  const failed = database(4);
  await assert.rejects(migration.up(failed.queryInterface), /simulated database failure/);
  assert.equal(failed.events.at(-1), "rollback");
  assert.deepEqual(failed.committed, []);
});

test("type conversions use explicit casts and omitted allowNull restores nullable", async () => {
  const old = structuredClone(before);
  old.staff.schema.code = { seqType: "Sequelize.STRING(40)", allowNull: false };
  const next = structuredClone(old);
  next.staff.schema.code = { seqType: "Sequelize.INTEGER" };
  const migration = loadMigration(old, next);
  const db = database();
  await migration.up(db.queryInterface);
  const sql = db.calls.filter((call) => call.method === "query").map((call) => call.args[0]).join("\n");
  assert.match(sql, /TYPE INTEGER USING \("code"::INTEGER\)/);
  assert.match(sql, /DROP NOT NULL/);
  assert.equal(db.calls.at(-1).args[2].allowNull, true);
  await migration.down(db.queryInterface);
  assert.equal(db.calls.at(-1).args[2].allowNull, false);
});
