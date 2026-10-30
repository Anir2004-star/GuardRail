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

Startup validates the database/server variables and the authentication settings below. DATABASE_URL must exist and use
`postgresql://` or `postgres://` with a host and database name. Validation errors
never echo the supplied connection string.

### Authentication settings (configuration step)

Add these to `backend/.env`, preserving the existing database and server settings:

```dotenv
JWT_ACCESS_SECRET=replace_with_your_generated_64_character_hex_secret
JWT_ISSUER=guardrail-api
JWT_AUDIENCE=guardrail-web
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_SESSION_TTL_SECONDS=604800
BCRYPT_ROUNDS=12
```

Generate your own signing secret in the backend terminal:

```cmd
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy only its output over the JWT_ACCESS_SECRET placeholder, on the same line.
Keep it private; never share terminal output or commit `.env`. The application
requires a 32-to-128-byte hex secret (64 to 256 characters), rejecting obvious
placeholders and low-diversity values. Format checks cannot establish randomness;
use the cryptographic generator above. There is no default signing secret.

Issuer and audience default to the shown identifiers and must be nonempty ASCII
strings without whitespace (up to 200 characters). Access tokens default to 900
seconds (15 minutes), allowed range 60 to 3600. Refresh sessions default to 604800
seconds (7 days), allowed range 3600 to 2592000 (30 days). Bcrypt rounds default to
12, allowed range 10 to 14. These are configuration settings only at this step;
registration, token issuance, cookies and sessions are implemented in later steps.
No JWT_REFRESH_SECRET is used because refresh tokens will be opaque random values.

### Authentication database preparation (step 4)

Migration `20261023212452_add_password_hash_and_refresh_sessions` adds a nullable
`users.password_hash` column and the `refresh_sessions` table. It adds no default
password and does not recreate or delete users. Password registration will write
a 60-character bcrypt hash; a user whose hash is null must not be allowed to log
in with a password when the login service is added.

Refresh sessions store a UUID ID, user relation, unique 64-character SHA-256 token
hash, family UUID, creation/expiry/revocation timestamps, and an optional unique
replacement-session relation. No raw refresh-token column exists. Indexes support
user lookup, family revocation and expiry cleanup; unique constraints already
index the token hash and replacement ID. Deleting a user deletes their sessions.

The future auth service must keep the same family ID and fixed expiry during
rotation, revoke/consume the predecessor atomically, and retain consumed rows
through the family's expiry so reuse can be recognized. There is no cleanup job
or rotation service at this stage; the schema alone does not enforce these flows.
No password hashing, registration, login, cookies or token issuance is implemented
in step 4.

Apply the migration and regenerate the client from the backend folder:

```cmd
npm run db:validate
npm run db:deploy
npm run db:generate
npm run typecheck
npm test
```

For isolated verification after building:

```cmd
npm run build
npm run db:verify:auth-schema
```

That script requires a local database role with CREATE DATABASE permission. It
creates a uniquely named `guardrail_step4_test_...` database, adds a temporary
legacy user under the old schema, applies the new migration SQL, checks record
preservation, session relations and uniqueness constraints, and removes only its
own temporary database. It never inserts test users or sessions into Guardrail's
development database. The normal test suite does not need that permission.

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

## Registration service (step 7)

`src/services/auth.service.ts` exports `registerUser(input)`. It validates first,
middle (optional), and last names, accepts any valid email provider, and normalizes
email whitespace/case without Gmail-specific rewriting. Passwords must have at
least 15 Unicode characters, at most 72 UTF-8 bytes, an ASCII uppercase letter,
an ASCII lowercase letter, a number and a special character. Passwords, including
their leading/trailing spaces, are passed unchanged to asynchronous bcrypt.

The service hashes using BCRYPT_ROUNDS (default 12), stores only the hash, saves
the separate names and combined display name, and selects only safe profile
fields for its result. It creates no refresh session or access token. Calling
this service does not automatically log anyone in. Names can repeat across
different email accounts, and bcrypt independently salts each password hash.

The `normalize_user_emails` migration checks for normalization collisions before
updating existing emails, then adds a normalized-email check. The existing unique
email constraint remains authoritative for simultaneous requests. The central
handler recognizes both Prisma target fields and the Prisma 7 pg adapter's
unique-index metadata, returning HTTP 409 with EMAIL_ALREADY_REGISTERED.
This message reveals account existence; email verification is not yet built.
Other database errors remain generic and their values are not logged.

The public `POST /api/v1/auth/register` route is now connected in `src/app.ts`.
It requires an Origin exactly matching FRONTEND_ORIGIN, allows ten attempts per
client IP per fifteen minutes, validates input, then invokes the registration
controller and service. Missing/unexpected origins return 403; exceeding the
limit returns 429 with Retry-After. Validation failures count toward the limit.
The in-memory limiter is suitable for this single-process local setup; multiple
instances need a shared store, and trusted proxies must be configured explicitly
when deploying. Auth responses are not cached. Registration issues no login
tokens or cookies; the frontend signup screen still demonstrates local profile
changes and has not yet been connected to this API.

Run from `backend` with the local PostgreSQL service healthy:

```cmd
npm run db:deploy
npm run db:generate
npm run typecheck
npm test
npm run test:registration
```

`test:registration` builds the backend, creates a randomly named local test
database, applies all committed migrations using Prisma Migrate, and runs
`tests/integration/registration.test.mjs` in a separate process. Guards reject a
missing test URL or development database target. Only the generated test database
is dropped afterward; no development records are inserted or deleted. The local
role needs CREATE DATABASE permission. Test HTTP endpoints bind to an ephemeral
loopback port inside the test process only. The integration suite uses the real
application, router, controller, origin middleware and rate limiter; it no longer
substitutes a test-only registration route.

Integration tests cover real bcrypt storage and comparison, safe returned fields,
normalized duplicates, concurrent duplicates, optional middle names, repeated
names with distinct emails, rejection of invalid input and the database email
normalization constraint. It also checks missing/incorrect Origin rejection,
allowed CORS preflight, 429 throttling, and continuing health/readiness responses.
It reports the measured cost of registration at the
configured bcrypt work factor; deployment load testing is still needed.

## Reference links

- [Prisma 7 configuration and adapters](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Generated Prisma Client](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [node-postgres connection/query timeouts](https://node-postgres.com/apis/client)
- [Official PostgreSQL container](https://hub.docker.com/_/postgres)
