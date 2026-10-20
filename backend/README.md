# Guardrail backend — milestone 1

This directory contains the first Guardrail backend milestone: a small Express server written in strict TypeScript. It provides security headers, restricted CORS, request logging, JSON parsing, consistent error responses, graceful shutdown, and a basic health endpoint.

It does **not** contain authentication, a database, Google integrations, an LLM, queues, device pairing, or real file operations.

## Prerequisites

- Node.js 22 or newer. Use a currently supported Node.js LTS release.
- npm, which is included with Node.js.

## Install

Open a terminal in the `backend` directory:

```powershell
cd backend
npm install
```

Create your local environment file from the committed example.

PowerShell:

```powershell
Copy-Item .env.example .env
```

Windows Command Prompt:

```bat
copy .env.example .env
```

macOS or Linux:

```sh
cp .env.example .env
```

The default settings run the backend on port `4000` and allow browser requests from the frontend at `http://localhost:3000`. Do not commit `.env`.

## Development

Start the server with automatic reload:

```powershell
npm run dev
```

Then open [http://localhost:4000/health](http://localhost:4000/health) in a browser.

Expected response:

```json
{
  "status": "ok",
  "message": "Guardrail backend is running"
}
```

## Type checking and production build

Check the TypeScript types without generating files:

```powershell
npm run typecheck
```

Compile the server into `dist`:

```powershell
npm run build
```

Run the compiled server without `tsx`:

```powershell
npm start
```

Stop the server with `Ctrl+C`. The server stops accepting new connections and gives active requests up to ten seconds to finish.

## Environment validation

Startup fails with a clear message when:

- `PORT` is not an integer from 1 through 65535.
- `NODE_ENV` is not `development`, `test`, or `production`.
- `FRONTEND_ORIGIN` is not an HTTP or HTTPS origin.

Only the configured frontend origin receives an `Access-Control-Allow-Origin` response header. CORS is not authentication and credentials are not enabled.
