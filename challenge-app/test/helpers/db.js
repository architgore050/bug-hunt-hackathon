"use strict";

// Direct database access for tests that need to look behind the API.
process.env.PAPYRUS_DB = process.env.PAPYRUS_DB || ":memory:";

const { openDb, resetDbForTest } = require("../../db/client");

module.exports = { openDb, resetDbForTest };
