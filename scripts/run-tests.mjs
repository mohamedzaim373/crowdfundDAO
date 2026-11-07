import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(["./node_modules/hardhat/dist/src/cli.js", "build"]);
run([
  "--import",
  "tsx/esm",
  "./node_modules/mocha/bin/mocha.js",
  "./test/CrowdfundDAO.ts",
  "./audit/verification.test.ts",
  "--reporter",
  "spec",
  "--timeout",
  "40000",
]);
