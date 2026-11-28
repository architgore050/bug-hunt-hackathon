"use strict";

const { httpError } = require("./validate");

// Route guards. requireAuth is the minimum bar for anything tied to an
// account; requireAdmin additionally checks the users.is_admin flag loaded
// by the session middleware. The admin corner answers 403 (not 401) so that
// anonymous probing is indistinguishable from non-admin access.
function requireAuth(req, res, next) {
  if (!req.user) {
    return next(httpError(401, "unauthorized", "Sign in first."));
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return next(httpError(403, "forbidden", "Admins only."));
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
