# Verified compatibility

Local checks on Windows, 2026-09-15. Each combination below passed all 13 tests.

| Node.js | Sequelize | sequelize-cli | Result |
| --- | --- | --- | --- |
| 22.17.0 | 5.22.5 | 5.5.1 | Passed |
| 22.17.0 | 6.3.0 | 6.0.0 | Passed |
| 22.17.0 | 6.37.8 | 6.6.5 | Passed |
| 18.20.8 | 6.37.8 | 6.6.5 | Passed |
| 26.8.2 | 6.37.8 | 6.6.5 | Passed |

Sequelize 6.37.8, CLI 6.6.5 and Node 26.8.2 were resolved from npm's `latest`
tags during verification. Sequelize 7 (`@sequelize/core`) is alpha and is not
supported. PostgreSQL only; CommonJS model/config files only.

Coverage: generated up/down transactions and rollback after errors, enum/type/
nullability SQL construction, numeric applied-revision selection, independent
CLI help, preview, migration creation, quoted enum labels, snapshot reuse, and
project-relative paths when launched from another working directory.

These tests do not connect to PostgreSQL or execute sequelize-cli undo against
a database. The CLI version is installed/resolved; actual database compatibility
depends on your PostgreSQL version, data, constraints and dependencies. The
included CI matrix is for future automated verification and has not been run
on GitHub during this local build. Compatibility does not imply upstream security
support for end-of-life Sequelize or Node releases.

Version 0.1.1 removes all package runtime dependencies. Sequelize, sequelize-cli,
and pg remain peer dependencies provided by the consuming application.

Version 0.1.2 fixes false unsupported-array warnings for unchanged index fields.
