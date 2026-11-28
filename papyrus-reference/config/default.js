"use strict";

// Static defaults. Units are documented here and in docs/CONFIG.md:
// durations are seconds, sizes are rows or bytes, nothing is milliseconds.
const DEFAULTS = {
  // Session cookie lifetime in seconds (7 days). Signed in users stay
  // signed in for this long; see http/middleware/session.js for the cookie.
  sessionTtlSeconds: 604800,

  // Maximum accepted JSON request body, in bytes.
  jsonBodyLimitBytes: 65536,

  // Admin digest worker cadence, in seconds.
  digestIntervalSeconds: 300,

  // Listener defaults. PAPYRUS_PORT overrides the port.
  port: 4173,
  host: "127.0.0.1",
};

module.exports = DEFAULTS;
