"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { selectLatestMigration } = require("../lib/undo-last-migration");

test("selects 128 ahead of 99 regardless of metadata ordering", () => {
  const names = ["1-noname.js", "128-noname.js", "127-noname.js", "99-noname.js"];
  assert.equal(selectLatestMigration(names), "128-noname.js");
  assert.equal(selectLatestMigration([...names].reverse()), "128-noname.js");
});

test("only applied revisions participate in rollback selection", () => {
  assert.equal(selectLatestMigration(["99-noname.js", "127-noname.js"]), "127-noname.js");
  assert.equal(selectLatestMigration([]), null);
});

test("older duplicate revisions do not block an unambiguous latest revision", () => {
  assert.equal(selectLatestMigration(["100-a.js", "100-b.js", "128-noname.js"]), "128-noname.js");
  assert.equal(selectLatestMigration(["128-noname.js", "100-a.js", "100-b.js"]), "128-noname.js");
});

test("orders padded and large numeric prefixes without precision loss", () => {
  assert.equal(selectLatestMigration(["0099-old.js", "0128-new.js"]), "0128-new.js");
  assert.equal(selectLatestMigration(["9007199254740993-new.js", "9007199254740992-old.js"]), "9007199254740993-new.js");
});

test("rejects ambiguous or nonnumeric names instead of guessing a rollback target", () => {
  assert.throws(() => selectLatestMigration(["128-a.js", "128-b.js"]), /Multiple applied migrations/);
  assert.throws(() => selectLatestMigration(["128-a.js", "0128-b.js"]), /Multiple applied migrations/);
  assert.throws(() => selectLatestMigration(["manual.js"]), /Cannot determine numeric migration order/);
});
