"use strict";
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

function project(values) {
  const root = path.resolve(values.cwd || process.cwd());
  const resolve = (file) => path.resolve(root, file);
  const projectRequire = createRequire(path.join(root, "package.json"));
  const rc = resolve(values.sequelizerc || ".sequelizerc");
  const paths = fs.existsSync(rc) ? projectRequire(rc) : {};
  return {
    root, projectRequire,
    models: resolve(values["models-path"] || paths["models-path"] || "models"),
    migrations: resolve(values["migrations-path"] || paths["migrations-path"] || "migrations"),
    config: resolve(values.config || paths.config || "config/config.json"),
  };
}

function assertCompatible(projectRequire) {
  const version = projectRequire("sequelize/package.json").version;
  if (!/^[56]\./.test(version)) {
    throw new Error("Supported Sequelize majors are 5 and 6; found " + version + ". Sequelize 7 alpha is not supported.");
  }
}

const pathOptions = {
  cwd: { type: "string" },
  sequelizerc: { type: "string" },
  config: { type: "string" },
  "models-path": { type: "string" },
  "migrations-path": { type: "string" },
};
module.exports = { project, assertCompatible, pathOptions };
