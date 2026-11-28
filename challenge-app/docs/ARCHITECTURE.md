# Papyrus architecture

## Layering

Requests flow in one direction; each layer only talks to the one below it.

```text
public/ (browser)      ES modules, hash router, render helpers
  |
http/routes/           express routers: parse, guard, delegate, serialize
  |
services/              use cases: validation, authorization, orchestration
  |
domain/                pure rules: hashing, sanitize, slugs, sort whitelist
  |
db/queries/            prepared statements only, one module per table
  |
db/client.js           node:sqlite connection + schema init (schema.sql + migrate.js)
```

Cross-cutting pieces live in `http/middleware/`: cookie sessions
(`session.js`), route guards (`require-auth.js`), input helpers
(`validate.js`), the rate limiter for credential endpoints
(`rate-limit.js`), and the central error handler that keeps driver details
out of responses (`error-handler.js`). Serializers in `http/serializers/`
own the public field names documented in `docs/API.md`.

## Conventions

- Routers are factories of one `express.Router` each, wired in `server.js`.
- Query modules accept plain row-shaped objects (snake_case keys) and never
  construct SQL from request input; sort keys go through the whitelist in
  `domain/pagination.js`.
- Services raise `Error` objects with `status` and `code`; the central
  handler turns them into JSON. Unknown errors become a generic 500.
- The digest worker runs from `server.js` on a timer and is also exported
  as `runOnce(db)` so it can be driven step by step.
- The browser app is a no-build ES-module SPA. Modules never touch the DOM
  at import time; wiring happens in `app.js` and in exported `wire*`
  helpers, which keeps the client modules importable from tests.

## Test layout

`test/unit/domain/` covers the pure rules. `test/integration/api/` boots the
real app on an ephemeral port with an in-memory database and exercises the
HTTP contract, including a cold-start and warm-start smoke pass.
