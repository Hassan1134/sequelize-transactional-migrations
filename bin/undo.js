#!/usr/bin/env node
"use strict";
require("../lib/undo-last-migration").main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
