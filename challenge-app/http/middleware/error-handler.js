"use strict";

// Central error handling. Full details go to the server log only; response
// bodies never contain driver messages, stack traces or file paths.
const LOG_PREFIX = "[papyrus:error]";

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  const code = err.code || (status >= 500 ? "internal_error" : "request_invalid");
  if (status >= 500) {
    console.error(LOG_PREFIX, req.method, req.originalUrl, "-", err.message);
  }
  res.status(status).json({
    error: code,
    detail: err.message,
    request_id: req.id || null,
  });
}

module.exports = { errorHandler };
