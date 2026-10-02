# Compatibility evidence

Historical local checks on Windows, 2026-09-15. Each combination below passed
the 13 tests available at that time. These results do not cover the new live
PostgreSQL integration test.

| Node.js | Sequelize | sequelize-cli | Result |
| --- | --- | --- | --- |
| 22.17.0 | 5.22.5 | 5.5.1 | Passed |
| 22.17.0 | 6.3.0 | 6.0.0 | Passed |
| 22.17.0 | 6.37.8 | 6.6.5 | Passed |
| 18.20.8 | 6.37.8 | 6.6.5 | Passed |
| 26.8.2 | 6.37.8 | 6.6.5 | Passed |

Live PostgreSQL check on Windows, 2026-10-02: Node 22.17.0, Sequelize
6.37.8, sequelize-cli 6.6.5, pg 8.23.0, and PostgreSQL 16. The integration
test applied generated migrations, changed a column type and index uniqueness,
verified rollback after a failed migration, and undid the latest applied
migration. Other matrix combinations still need CI results before they can be
called live verified.

Sequelize 6.37.8, CLI 6.6.5 and Node 26.8.2 were resolved from npm's `latest`
tags during verification. Sequelize 7 (`@sequelize/core`) is alpha and is not
supported. PostgreSQL only; CommonJS model/config files only.

Coverage: generated up/down transactions and rollback after errors, enum/type/
nullability SQL construction, numeric applied-revision selection, independent
CLI help, preview, migration creation, quoted enum labels, snapshot reuse, and
project-relative paths when launched from another working directory.

The test suite now includes an opt-in PostgreSQL integration test that generates
and applies migrations, checks database rollback after failure, and runs the
package's CLI undo command. It runs when `TEST_DATABASE_URL` is set. CI provides
PostgreSQL 16 for every matrix job; CI results should be checked before claiming
those combinations are end-to-end verified. Database compatibility also depends
on data, constraints and dependencies. Compatibility does not imply upstream
security support for end-of-life Sequelize or Node releases.

Version 0.1.1 removes all package runtime dependencies. Sequelize, sequelize-cli,
and pg remain peer dependencies provided by the consuming application.

Version 0.1.2 fixes false unsupported-array warnings for unchanged index fields.

Unreleased work adds recoverable snapshot writes, preserves more index options
and PostgreSQL ARRAY element types, and resolves the installed CLI executable
from its package metadata.
