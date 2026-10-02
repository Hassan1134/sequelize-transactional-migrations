"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Sequelize = require("sequelize");
const { reverseModels } = require("../lib/vendor/migrate");
const { renderMigration } = require("../lib/make-migration");

test("generator preserves PostgreSQL ARRAY element types and index options", () => {
  const sequelize = new Sequelize("postgres://test:test@localhost/test", { logging: false });
  const Item = sequelize.define("item", {
    tags: { type: Sequelize.ARRAY(Sequelize.UUID) },
    code: { type: Sequelize.STRING(40) },
  }, { indexes: [{ fields: ["code"], name: "items_code_idx", unique: true, using: "btree" }] });
  const tables = reverseModels({ sequelize }, { Item });
  const table = tables[Item.tableName];
  assert.equal(table.schema.tags.seqType, "Sequelize.ARRAY(Sequelize.UUID)");
  const index = Object.values(table.indexes)[0];
  assert.equal(index.options.unique, true);
  assert.equal(index.options.using, "btree");
  assert.equal(index.options.name, "items_code_idx");
  assert.deepEqual(index.fields, ["code"]);
});

test("changing an index option emits remove and add with the new options", () => {
  const before = { items: {
    tableName: "items", schema: { code: { seqType: "Sequelize.STRING" } },
    indexes: { old: { fields: ["code"], options: { name: "items_code_idx" } } },
  } };
  const after = structuredClone(before);
  after.items.indexes = {
    next: { fields: ["code"], options: { name: "items_code_idx", unique: true, using: "btree" } },
  };
  const migration = renderMigration(before, after, { revision: 1 });
  assert.match(migration, /fn: "removeIndex"/);
  assert.match(migration, /fn: "removeIndex", params: \[\s*"items",\s*"items_code_idx"/);
  assert.match(migration, /fn: "addIndex"/);
  assert.match(migration, /"unique":true/);
  assert.match(migration, /"using":"btree"/);
});
