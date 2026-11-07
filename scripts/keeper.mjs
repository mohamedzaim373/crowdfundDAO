import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Contract, JsonRpcProvider } from "ethers";

// This development executor only signs through Hardhat's unlocked local account.
// It never accepts a private key and refuses public networks.
export async function executeReadyProposals(provider, deployment) {
  if ((await provider.getNetwork()).chainId !== 31337n || deployment.chainId !== "31337") {
    throw new Error("L'exécuteur de démonstration exige Hardhat Local (31337).");
  }
  const artifact = JSON.parse(await readFile(new URL("../artifacts/contracts/CampaignGovernance.sol/CampaignGovernance.json", import.meta.url), "utf8"));
  const governance = new Contract(deployment.contracts.CampaignGovernance, artifact.abi, await provider.getSigner(0));
  const count = await governance.proposalCount();
  for (let id = 1n; id <= count; id++) {
    if (await governance.state(id) !== 3n) continue;
    try {
      await (await governance.execute(id)).wait();
      console.log(`Proposition #${id} exécutée automatiquement.`);
    } catch (error) {
      // A campaign may have been cancelled, paid or frozen since the vote.
      console.error(`Proposition #${id} non exécutable: ${error.shortMessage ?? error.message}`);
    }
  }
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  const deployment = JSON.parse(await readFile("deployments/localhost.json", "utf8"));
  if ((await provider.getNetwork()).chainId !== 31337n) throw new Error("Réseau local requis.");
  if (process.argv.includes("--once")) {
    await executeReadyProposals(provider, deployment);
    provider.destroy();
    return;
  }
  await provider.send("evm_setIntervalMining", [2000]);
  console.log("Exécuteur local actif ; un bloc toutes les 2 secondes.");
  const stop = async () => {
    await provider.send("evm_setIntervalMining", [0]).catch(() => {});
    provider.destroy();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (;;) {
    try { await executeReadyProposals(provider, deployment); }
    catch (error) { console.error(error.shortMessage ?? error.message); }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exit(1); });
}
