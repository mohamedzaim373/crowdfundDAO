// Publie le code source des quatre contrats sur les explorateurs configurés
// (Sourcify toujours, Etherscan si ETHERSCAN_API_KEY est défini).
//
//   npm run verify:source -- sepolia
//
// Les arguments de constructeur sont reconstitués depuis deployments/<réseau>.json
// plutôt que saisis à la main : une erreur d'argument fait échouer la
// vérification avec un message peu lisible, et le manifeste est la seule source
// qui décrit réellement ce qui a été déployé.
import { spawn } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";

const network = process.argv[2] ?? "sepolia";
const manifestPath = `deployments/${network}.json`;

let deployment;
try {
  deployment = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  console.error(`Manifeste introuvable : ${manifestPath}`);
  console.error(`Déployez d'abord sur ce réseau (npm run deploy:${network}).`);
  process.exit(1);
}

const { contracts, parameters: p, deployer } = deployment;
if (!p.treasuryOwners) {
  console.error("Ce manifeste est antérieur à l'enregistrement de treasuryOwners.");
  console.error("Redéployez pour pouvoir vérifier MultiSigTreasury automatiquement.");
  process.exit(1);
}

// Doit refléter exactement l'ordre des constructeurs dans contracts/*.sol.
const targets = [
  {
    name: "CFDToken",
    fq: "contracts/CFDToken.sol:CFDToken",
    args: [deployer],
  },
  {
    name: "CrowdfundingCore",
    fq: "contracts/CrowdfundingCore.sol:CrowdfundingCore",
    args: [contracts.CFDToken, deployer, p.tokenRate],
  },
  {
    name: "CampaignGovernance",
    fq: "contracts/CampaignGovernance.sol:CampaignGovernance",
    args: [
      contracts.CFDToken,
      contracts.CrowdfundingCore,
      p.votingPeriodBlocks,
      p.executionDelayBlocks,
      p.quorumBps,
    ],
  },
  {
    name: "MultiSigTreasury",
    fq: "contracts/MultiSigTreasury.sol:MultiSigTreasury",
    args: [p.treasuryOwners, p.treasuryThreshold],
  },
];

const argsFile = "constructor-args.tmp.js";

// `hardhat verify` interroge plusieurs explorateurs et sort en échec dès que
// l'un d'eux refuse, même si un autre a publié le contrat. Se fier au code de
// sortie ferait donc passer un succès pour un échec : on relit la sortie pour
// savoir quels explorateurs ont réellement accepté.
const run = (args) =>
  new Promise((resolve) => {
    let output = "";
    const child = spawn("npx", ["hardhat", ...args], {
      stdio: ["inherit", "pipe", "pipe"],
      shell: true,
    });
    const tee = (stream, sink) =>
      stream.on("data", (chunk) => {
        output += chunk;
        sink.write(chunk);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on("close", (code) => {
      const verified = [...output.matchAll(/verified successfully on (\w+)/gi)].map((m) => m[1]);
      resolve({ code: code ?? 1, verified });
    });
  });

let failed = 0;
// Le fichier d'arguments est temporaire : il doit disparaître même si une
// vérification échoue ou si l'utilisateur interrompt la commande.
const cleanup = () => rm(argsFile, { force: true });
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});
const summary = [];
try {
  for (const target of targets) {
    const address = contracts[target.name];
    console.log(`\n=== ${target.name} — ${address} ===`);
    await writeFile(argsFile, `export default ${JSON.stringify(target.args, null, 2)};\n`, "utf8");
    const { verified } = await run([
      "verify",
      "--network", network,
      "--contract", target.fq,
      "--constructor-args-path", argsFile,
      address,
    ]);
    if (verified.length === 0) failed++;
    summary.push({ name: target.name, address, verified });
  }
} finally {
  await cleanup();
}

// Le bilan interroge Sourcify plutôt que de se fier à la sortie de Hardhat :
// un contrat déjà publié lors d'un passage précédent n'affiche plus le message
// de succès, et `hardhat verify` sort en échec dès qu'un seul explorateur
// refuse, même quand un autre a accepté. Seul l'état réel fait foi.
console.log("\n--- Bilan de publication ---");
failed = 0;
for (const { name, address, verified } of summary) {
  let state = verified.length > 0 ? verified.join(", ") : null;
  try {
    const res = await fetch(`https://sourcify.dev/server/v2/contract/${deployment.chainId}/${address}`, {
      headers: { "User-Agent": "crowdfund-dao-verify/1.0" },
    });
    if (res.ok) {
      const match = (await res.json()).match;
      if (match) state = `Sourcify (${match})`;
    }
  } catch {
    // Sourcify injoignable : on retombe sur ce qu'a rapporté Hardhat.
  }
  if (state === null) failed++;
  console.log(`${state !== null ? "OK  " : "FAIL"}  ${name} — ${state ?? "non publié"}`);
  console.log(`      ${address}`);
}
console.log(
  failed === 0
    ? "\nLes quatre contrats sont publiés."
    : `\n${failed} contrat(s) publié(s) nulle part.`,
);
process.exitCode = failed === 0 ? 0 : 1;
