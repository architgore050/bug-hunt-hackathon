"use strict";

// Environment overrides. Anything set here wins over config/default.js.
//   PAPYRUS_PORT       TCP port for the HTTP listener.
//   PAPYRUS_HOST       Bind address for the HTTP listener.
//   PAPYRUS_DB         sqlite database file path; ":memory:" is supported.
//   PAPYRUS_PAGE_LIMIT default page size for list endpoints, in rows.
const DEFAULTS = require("./default");

const env = {
  port: positiveInt(process.env.PAPYRUS_PORT, DEFAULTS.port),
  host: process.env.PAPYRUS_HOST || DEFAULTS.host,
  databaseFile: process.env.PAPYRUS_DB || "data/papyrus.sqlite",
  pageLimit: pageLimitFrom(process.env.PAPYRUS_PAGE_LIMIT),
  digestIntervalSeconds: positiveInt(process.env.PAPYRUS_DIGEST_S, DEFAULTS.digestIntervalSeconds),
};

function positiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// The default page size is 25 rows. An explicit PAPYRUS_PAGE_LIMIT must parse
// to a positive integer; anything else falls back to the default above.
function pageLimitFrom(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return 25;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 25;
}

module.exports = env;
