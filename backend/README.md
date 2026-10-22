# Guardrail backend - database milestone

Express + strict TypeScript with PostgreSQL and Prisma 7.10.1. PostgreSQL stores
application data. Prisma lets TypeScript query it. A migration records a database
structure change; the initial migration creates only `users`. Prisma Studio is a
local tool for inspecting data. Authentication is a later milestone.

## Requirements

- Node.js 22.12+ (22.x) or Node.js 24+; verified with Node 24.16.
- npm and Docker Desktop with its Linux engine running.
- Run all commands below from `GuardRail/backend`, not the repository root.

Docker runs **only the local PostgreSQL database**. Express continues running
directly on your computer with `npm run dev`.

## First-time setup

### 1. Configure the environment

In Windows Command Prompt (the VS Code terminal labelled `cmd`):

```cmd
cd C:\Users\ACER\OneDrive\Desktop\GuardRail\backend
if not exist .env.postgres copy .env.postgres.example .env.postgres
if not exist .env copy .env.example .env
```

PowerShell equivalents for copying without overwriting existing files:

```powershell
if (!(Test-Path .env.postgres)) { Copy-Item .env.postgres.example .env.postgres }
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

On macOS/Linux use `cp -n .env.postgres.example .env.postgres` and
`cp -n .env.example .env`.

Edit `.env.postgres` with a local password of your own:

```dotenv
POSTGRES_USER=guardrail_local
POSTGRES_PASSWORD=replace_with_local_password
POSTGRES_DB=guardrail
POSTGRES_PORT=5432
```

Edit `.env` using the **same** credentials and database name:

```dotenv
PORT=4000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://guardrail_local:replace_with_local_password@localhost:5432/guardrail?schema=public
```

Replace both password placeholders. URL-encode special characters in the URL's
username/password (for example `@` becomes `%40`). These actual environment files
are gitignored; never commit or share them.

Compose reads `.env.postgres` through the explicit `--env-file` argument below.
The backend and Prisma CLI load `.env` using dotenv. Existing process environment
variables take precedence over `.env`.

If port 5432 is occupied, use `POSTGRES_PORT=5433` in `.env.postgres` and
`localhost:5433` in `.env`. The current local Guardrail setup uses **5433** because
another project owns 5432. Examples keep 5432 as the conventional default.

Startup validates all four backend variables. DATABASE_URL must exist and use
`postgresql://` or `postgres://` with a host and database name. Validation errors
never echo the supplied connection string.

### 2. Start PostgreSQL

Open Docker Desktop and wait for its engine to run, then:

```cmd
docker info
docker compose --env-file .env.postgres config --quiet
docker compose --env-file .env.postgres up -d --wait
docker compose --env-file .env.postgres ps
```

The service should show `healthy`. PostgreSQL 17 binds only to localhost and keeps
its data in the named `guardrail-local_postgres_data` volume. The health check
waits for PostgreSQL to accept connections.

If Docker reports a missing `dockerDesktopLinuxEngine` pipe, start Docker Desktop.
If another database already uses the selected port, change the two port settings
above; do not stop another project's database.

### 3. Install dependencies and generate Prisma Client

```cmd
npm ci
npm run db:validate
npm run db:generate
```

Generate the client **before** type-checking or compiling. Generated TypeScript
lives in `src/generated/prisma`, is gitignored, and compiles into `dist` with the
backend. The Prisma CLI, client, and PostgreSQL adapter are pinned to the same
version. Prisma 7 keeps its database URL in `prisma.config.ts`, rather than in the
schema; its generated ESM client uses the `pg` driver adapter.

### 4. Apply the committed initial migration

For a new local database or another environment receiving committed migrations:

```cmd
npm run db:deploy
```

For a future intentional schema change during development:

```cmd
npm run db:migrate -- --name describe_your_change
npm run db:generate
```

`db:migrate` uses Prisma Migrate's development workflow and a shadow database;
the local Docker role can create it. On an existing externally managed database,
ask its administrator about permissions and migration history. Do not accept a
reset prompt or use `db push` to bypass migrations. Inspect conflicts first.
Production startup never creates or applies development migrations.

The initial model has a UUID ID, unique required email, optional name, default
creation timestamp, and Prisma-managed update timestamp. `users` and its timestamp
columns use snake_case. The email uniqueness constraint provides its index.
UUID values and `updated_at` are supplied by Prisma when creating records.

### 5. Check and start the backend

```cmd
npm run typecheck
npm run build
npm run dev
```

Leave that terminal running. In another backend terminal:

```cmd
curl.exe http://localhost:4000/health
curl.exe http://localhost:4000/ready
```

`/health` checks only that the HTTP server responds, with its original response:

```json
{"status":"ok","message":"Guardrail backend is running"}
```

`/ready` runs `SELECT 1`. A reachable database returns HTTP 200:

```json
{"status":"ready","database":"connected"}
```

An unavailable database returns HTTP 503 without credentials, raw errors, or
stack traces:

```json
{"status":"not_ready","database":"unavailable"}
```

The shared pool has a three-second connection/acquisition timeout and three-second
query/statement timeouts. A failed readiness request leaves the server running so
it can recover. `/ready` checks connectivity, not whether every migration is
applied; run `db:deploy` before serving application traffic.

For the compiled server use `npm start`. Ctrl+C stops HTTP traffic and disconnects
the shared Prisma client within the existing ten-second shutdown deadline.

### 6. Verify persistence and failure recovery

```cmd
npm run db:verify
npm test
node scripts/verify-readiness.mjs
```

`db:verify` creates one clearly marked temporary User with a random UUID, reads it
back, deletes exactly that record, and confirms cleanup. It exposes no HTTP user
creation endpoint. Tests use a fake unresponsive TCP database to check bounded 503
responses and continuing health responses, without changing real records.

For a **dedicated local database only**, run:

```cmd
node scripts/verify-readiness.mjs --outage
```

The script checks healthy responses, then prompts you to stop the database in
another terminal:

```cmd
docker compose --env-file .env.postgres stop postgres
```

Press Enter in the verification terminal to check `/ready` 503 and `/health` 200.
Restart the database in the other terminal:

```cmd
docker compose --env-file .env.postgres up -d --wait postgres
```

Press Enter again to check `/ready` recovers to 200. Do not run outage tests against
a shared or externally managed database. If a test fails while stopped, restart
the database with the command above.

### 7. Inspect data with Prisma Studio

```cmd
npm run db:studio
```

Open the local URL printed by Prisma Studio. Treat it as a development tool and
keep it local. Close it with Ctrl+C.

### 8. Stop PostgreSQL without deleting data

```cmd
docker compose --env-file .env.postgres stop
```

Use `up -d --wait` to start it again. Stopping a container does not delete its
volume. **Do not use `down -v` or remove the named volume** to fix connection or
migration problems. PostgreSQL initialization variables apply only when a volume
is first initialized: changing the password file later does not change an existing
database password. Update both the database role and backend configuration when
rotating credentials; do not reset the volume.

## Without Docker

Use an existing supported local PostgreSQL installation instead. Ask its owner
to create a dedicated `guardrail` database and a suitable local role, then set
DATABASE_URL in `.env` to that connection. Skip Compose commands; continue from
dependency installation, generation, and migration application. Never reuse or
reset an unrelated database. Prisma development migrations additionally need
permission to create a shadow database (or an explicitly configured dedicated
shadow database); applying committed migrations via `db:deploy` does not.

## References

- [Prisma 7 configuration and adapters](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Generated Prisma Client](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [node-postgres connection/query timeouts](https://node-postgres.com/apis/client)
- [Official PostgreSQL container](https://hub.docker.com/_/postgres)
