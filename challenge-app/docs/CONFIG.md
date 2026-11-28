# Papyrus configuration

Every duration in this codebase is in seconds, every size in rows or bytes.
There are no millisecond values in configuration; the one place that thinks
in milliseconds is the rate limiter window, documented below.

## Sources

1. `config/default.js` holds the static defaults, with units in comments.
2. `config/env.js` applies environment overrides and parsing rules.
3. Environment variables win; everything else falls back to the defaults.

## Values

| Key | Default | Env override | Unit | Used by |
| --- | --- | --- | --- | --- |
| `sessionTtlSeconds` | 604800 (7 days) | - | seconds | session cookie Max-Age and session row expiry (`http/middleware/session.js`) |
| `jsonBodyLimitBytes` | 65536 | - | bytes | `express.json({limit})` in `server.js` |
| `digestIntervalSeconds` | 300 | `PAPYRUS_DIGEST_S` | seconds | digest worker cadence (`workers/digest.js`) |
| `port` | 4173 | `PAPYRUS_PORT` | TCP port | HTTP listener |
| `host` | 127.0.0.1 | `PAPYRUS_HOST` | address | HTTP listener |
| `databaseFile` | `data/papyrus.sqlite` | `PAPYRUS_DB` | path | `db/client.js`; `:memory:` is supported |
| default page limit | 25 | `PAPYRUS_PAGE_LIMIT` | rows | list endpoints via `domain/pagination.js` `clampLimit` |

## Rate limiter

The credential endpoints (register, login) sit behind a fixed-window limiter
(`http/middleware/rate-limit.js`): `WINDOW_MS` is 60000 milliseconds (one
minute) and `MAX_REQUESTS_PER_WINDOW` is 40 attempts per client IP. The
41st attempt inside one window receives a 429 with `Retry-After`.

## Page size rules

`PAPYRUS_PAGE_LIMIT` must parse to a positive integer; anything else falls
back to 25. Explicit `?limit=` values are clamped to [1, 100] by
`clampLimit`; page numbers start at 1 and never produce a negative offset.
