/**
 * Runs the compiled VHDL parser tests.
 *
 * `npm run test:vhdl` compiles the parser and the tests to CommonJS into
 * `.tmp-vhdl-tests/`, then calls this file. It marks that folder as CommonJS
 * (the repository itself is an ES module package) and runs the test entry.
 */

const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(__dirname, "..", ".tmp-vhdl-tests");
fs.writeFileSync(path.join(outDir, "package.json"), '{"type":"commonjs"}\n');

require(path.join(outDir, "scripts", "vhdl-part-tests.js"));
