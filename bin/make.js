#!/usr/bin/env node
"use strict";
require("../lib/make-migration").main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
