# sequelize-transactional-migrations

Generate transactional PostgreSQL migrations from Sequelize model changes and
undo the highest **applied numeric revision** (128 sorts after 99).

## Install

This is a local package, not a published npm release. From your application:

```sh
npm install --save-dev ../sequelize-transactional-migrations
```

The application must supply `sequelize`, `sequelize-cli`, and `pg`. Match CLI 5
with Sequelize 5, or CLI 6 with Sequelize 6. Keep your existing migration scripts
until you have reviewed a preview from this package.

```json
{
  "scripts": {
    "db:makemigrations": "sequelize-make-migration",
    "db:down:last:local": "sequelize-undo-last-migration --env local",
    "db:migrate:local": "sequelize-cli db:migrate --env local"
  }
}
```

```sh
npm run db:makemigrations -- --name update_fields --preview
npm run db:makemigrations -- --name update_fields
npm run db:migrate:local
npm run db:down:last:local -- --dry-run
npm run db:down:last:local
```

## Configuration

Run from your application's root, or pass `--cwd /path/to/project`. Reads its
CommonJS `.sequelizerc`; without one, defaults to `models`, `migrations`, and
`config/config.json`. Options override those paths:

- Both commands: `--cwd`, `--sequelizerc`, `--models-path`, `--migrations-path`, `--config`, `--help`.
- Generation: `--name` / `-n`, `--comment` / `-c`, `--preview` / `-p`.
- Rollback: `--env` (defaults to `NODE_ENV` or `development`), `--dry-run`.

Models must export a Sequelize instance, or the usual CommonJS model registry
with `sequelize`. Generation uses the environment loaded by the model registry.
Rollback config supports named environment objects and `use_env_variable`.
Custom SequelizeMeta table/schema names are supported. JSON/file metadata storage
is not supported. CLI and Sequelize resolve from the consuming application.

## Behavior and limits

- Uses existing `_current.json` snapshots and numeric migration filenames.
- Each generated `up` and `down` runs sequentially in a managed transaction.
- Changes to existing types use explicit PostgreSQL casts. Nullable changes and
  enum additions/removals/reordering are emitted in both directions.
- Enum replacement requires valid existing data. Removed labels still present in
  rows, invalid casts, or NULL rows when setting NOT NULL cause rollback.
- Renaming an enum label is not a data migration. Edit the generated SQL when
  transforming data; review dependent views, shared enum types and constraints.
- Generation advances the snapshot, not the database. Existing applied drift
  requires a corrective migration; this tool does not introspect/repair drift.
- Review migrations before applying. Dropped data cannot be recovered by restoring
  only a table definition. `--execute` is intentionally rejected.
- Custom serializers, ESM model registries, TypeScript loaders and Sequelize 7
  alpha are not supported. The upstream difference engine has limitations for
  complex index and datatype changes; review generated output.

## Compatibility

Targets Node.js 18.20+ and Sequelize `^5.22.5 || ^6.3.0` with PostgreSQL.
Sequelize 6 is the current stable major; v7 is alpha and changes package names
and APIs: https://sequelize.org/releases/ . Older unsupported Node/Sequelize
majors are not claimed compatible. PostgreSQL support also depends on your ORM
and pg driver versions. See `COMPATIBILITY.md` for locally verified versions.

The CI workflow tests older and current ORM versions across Node releases.
Unit tests use Sequelize SQL generation with simulated database transactions;
they are not live PostgreSQL integration tests.

## Development and packing

```sh
npm install
npm test
npm pack
```

`npm pack` creates an installable `.tgz`. The package has no runtime dependencies;
Sequelize, Sequelize CLI, and pg are peers supplied by the application. The package allowlist excludes tests,
application models, environment files and migration snapshots. No application
files are modified on installation. No install hooks run. No npm publication
has been performed. Choose a license and confirm registry-name availability
before publishing (`UNLICENSED` until then).

Programmatic exports: `renderMigration(previousTables, currentTables, info)` and
`selectLatestMigration(appliedFilenames)`.
