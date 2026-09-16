"use strict";
module.exports = {
  renderMigration: require("./lib/make-migration").renderMigration,
  selectLatestMigration: require("./lib/undo-last-migration").selectLatestMigration,
};
