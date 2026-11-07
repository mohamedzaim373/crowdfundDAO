import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("frontend/src/generated", { recursive: true });
for (const name of ["CFDToken", "CrowdfundingCore", "CampaignGovernance", "MultiSigTreasury"]) {
  const artifact = JSON.parse(await readFile(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));
  await writeFile(`frontend/src/generated/${name}.json`, `${JSON.stringify(artifact.abi, null, 2)}\n`);
}
console.log("Front-end ABI exported from compiled contracts.");
