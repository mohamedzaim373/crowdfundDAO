import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Contract, JsonRpcProvider } from "ethers";

const network = process.argv[2] ?? "localhost";
if (!["localhost", "sepolia"].includes(network)) throw new Error("Réseau attendu : localhost ou sepolia.");
const rpc = network === "localhost" ? "http://127.0.0.1:8545" : process.env.SEPOLIA_RPC_URL;
if (!rpc) throw new Error("SEPOLIA_RPC_URL requis.");
const provider = new JsonRpcProvider(rpc);
try {
  const deployment = JSON.parse(await readFile(`deployments/${network}.json`, "utf8"));
  if ((await provider.getNetwork()).chainId.toString() !== deployment.chainId) throw new Error("Réseau et manifeste incompatibles.");
  const artifact = JSON.parse(await readFile("artifacts/contracts/CrowdfundingCore.sol/CrowdfundingCore.json", "utf8"));
  const core = new Contract(deployment.contracts.CrowdfundingCore, artifact.abi, provider);
  const end = await provider.getBlockNumber();
  const events = [];
  const blocks = new Map();
  for (let start = Number(deployment.deploymentBlock ?? 0); start <= end; start += 1000) {
    for (const log of await core.queryFilter(core.filters.ContributionReceived(), start, Math.min(end, start + 999))) {
      if (!blocks.has(log.blockNumber)) blocks.set(log.blockNumber, await provider.getBlock(log.blockNumber));
      events.push({ sender: log.args.contributor, amountWei: log.args.amount.toString(), timestamp: blocks.get(log.blockNumber).timestamp, txHash: log.transactionHash, campaignId: log.args.campaignId.toString() });
    }
  }
  await mkdir("audit", { recursive: true });
  await writeFile("audit/contributions.json", `${JSON.stringify(events, null, 2)}\n`);
  console.log(`${events.length} contributions exportées depuis ${network}.`);
} finally { provider.destroy(); }
