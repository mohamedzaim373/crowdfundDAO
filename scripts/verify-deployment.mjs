// Contrôle a posteriori d'un déploiement : relit la chaîne et vérifie que les
// paramètres, le câblage et les rôles correspondent au manifeste écrit par
// deploy.ts. Lecture seule : aucune transaction, aucune clé privée.
//
//   npm run verify:local
//   npm run verify:sepolia
//
// Les valeurs attendues viennent du manifeste lui-même, ce qui détecte aussi
// un manifeste périmé après un redémarrage de nœud ou un redéploiement.
import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, formatEther, id } from "ethers";

const rpc = process.argv[2] ?? "http://127.0.0.1:8545";
const manifestPath = process.argv[3] ?? "deployments/localhost.json";

const provider = new JsonRpcProvider(rpc);
const deployment = JSON.parse(await readFile(manifestPath, "utf8"));
const params = deployment.parameters;
const abi = async (name) =>
  JSON.parse(await readFile(`artifacts/contracts/${name}.sol/${name}.json`, "utf8")).abi;
const at = async (name) => new Contract(deployment.contracts[name], await abi(name), provider);

let failures = 0;
function check(label, actual, want) {
  const norm = (v) => (typeof v === "string" ? v.toLowerCase() : v);
  const ok = norm(actual) === norm(want);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}: ${actual}${ok ? "" : `  (attendu ${want})`}`);
}

const chainId = (await provider.getNetwork()).chainId;
console.log(`RPC ${rpc}`);
console.log(`Manifeste ${manifestPath}\n`);
check("chaîne conforme au manifeste", chainId, BigInt(deployment.chainId));

console.log("\n-- Code déployé --");
for (const [name, address] of Object.entries(deployment.contracts)) {
  check(`${name} (${address})`, (await provider.getCode(address)) !== "0x", true);
}

const token = await at("CFDToken");
const core = await at("CrowdfundingCore");
const gov = await at("CampaignGovernance");
const treasury = await at("MultiSigTreasury");

console.log("\n-- M1 : jeton de gouvernance --");
check("nom", await token.name(), "Crowdfund DAO");
check("symbole", await token.symbol(), "CFD");
check("décimales", await token.decimals(), 18n);
try {
  await token.delegate.staticCall("0x0000000000000000000000000000000000000001");
  console.log("FAIL  delegate() est encore appelable : le poids du vote peut quitter le solde");
  failures++;
} catch (error) {
  // ethers range le nom de l'erreur personnalisée dans `revert`, pas dans le message.
  check("delegate() révoque DelegationDisabled", error.revert?.name ?? error.shortMessage, "DelegationDisabled");
}

console.log("\n-- M2 : cœur du financement --");
check("tokensPerEth", await core.tokensPerEth(), BigInt(params.tokenRate));
check("jeton câblé", await core.governanceToken(), deployment.contracts.CFDToken);

console.log("\n-- M3 : gouvernance --");
check("votingPeriodBlocks", await gov.votingPeriodBlocks(), BigInt(params.votingPeriodBlocks));
check("executionDelayBlocks", await gov.executionDelayBlocks(), BigInt(params.executionDelayBlocks));
check("quorumBps", await gov.quorumBps(), BigInt(params.quorumBps));
check("jeton câblé", await gov.governanceToken(), deployment.contracts.CFDToken);
check("cœur câblé", await gov.crowdfundingCore(), deployment.contracts.CrowdfundingCore);

console.log("\n-- §5 : contrôle d'accès --");
check("Core est MINTER", await token.hasRole(id("MINTER_ROLE"), deployment.contracts.CrowdfundingCore), true);
check("Core est BURNER", await token.hasRole(id("BURNER_ROLE"), deployment.contracts.CrowdfundingCore), true);
check("Governance a GOVERNANCE_ROLE", await core.hasRole(id("GOVERNANCE_ROLE"), deployment.contracts.CampaignGovernance), true);
check("déployeur est PAUSER du jeton", await token.hasRole(id("PAUSER_ROLE"), deployment.deployer), true);
check("déployeur est PAUSER du cœur", await core.hasRole(id("PAUSER_ROLE"), deployment.deployer), true);
// Le déployeur ne doit ni frapper ni gouverner directement : seuls les
// contrats concernés détiennent ces pouvoirs.
check("déployeur n'est PAS MINTER", await token.hasRole(id("MINTER_ROLE"), deployment.deployer), false);
check("déployeur n'a PAS GOVERNANCE_ROLE", await core.hasRole(id("GOVERNANCE_ROLE"), deployment.deployer), false);

console.log("\n-- §5 : trésorerie 2-sur-3 --");
const owners = [await treasury.owners(0), await treasury.owners(1), await treasury.owners(2)];
console.log(`      propriétaires : ${owners.join(", ")}`);
check("trois propriétaires distincts", new Set(owners.map((o) => o.toLowerCase())).size, 3);
const threshold = await treasury.largeWithdrawalThreshold();
check("seuil (wei)", threshold, BigInt(params.treasuryThreshold));
console.log(`      soit ${formatEther(threshold)} ETH`);
check("2 confirmations au-dessus du seuil", await treasury.requiredConfirmations(threshold + 1n, false), 2n);
check("1 confirmation au seuil exact", await treasury.requiredConfirmations(threshold, false), 1n);
check("2 confirmations si la transaction porte des données", await treasury.requiredConfirmations(0n, true), 2n);

console.log(`\n${failures === 0 ? "Tous les contrôles passent." : `${failures} contrôle(s) en échec.`}`);
provider.destroy();
process.exitCode = failures === 0 ? 0 : 1;
