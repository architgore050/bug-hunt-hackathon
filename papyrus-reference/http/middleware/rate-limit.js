"use strict";

// Fixed-window rate limiter for the credential endpoints. The window is
// 60 seconds; each client IP gets 40 attempts per window and the 41st within
// the same window receives a 429 with a Retry-After hint.
const WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 40;

const buckets = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    res.setHeader("X-RateLimit-Remaining", String(MAX_REQUESTS_PER_WINDOW - 1));
    return next();
  }
  bucket.count += 1;
  const remaining = MAX_REQUESTS_PER_WINDOW - bucket.count;
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterS = Math.ceil((WINDOW_MS - (now - bucket.startedAt)) / 1000);
    res.setHeader("Retry-After", String(retryAfterS));
    return res.status(429).json({ error: "rate_limited", detail: "Too many attempts; slow down." });
  }
  return next();
}

// Buckets are cheap but not free; drop everything occasionally.
const CLEANUP_INTERVALS = 120;
const timer = setInterval(() => {
  buckets.clear();
}, WINDOW_MS * CLEANUP_INTERVALS);
timer.unref();

module.exports = { rateLimit, WINDOW_MS, MAX_REQUESTS_PER_WINDOW };
