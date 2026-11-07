import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import hre from "hardhat";

const { ethers, networkName } = await hre.network.create();
const [deployer, ownerTwo, ownerThree] = await ethers.getSigners();
if (!deployer) throw new Error("Aucun compte de déploiement : définissez SEPOLIA_PRIVATE_KEY pour Sepolia.");
const treasuryOwners = process.env.TREASURY_OWNERS?.split(",").map(address => address.trim()) ?? [deployer.address, ownerTwo?.address, ownerThree?.address];
if (treasuryOwners.length !== 3 || treasuryOwners.some(address => !address || !ethers.isAddress(address)) || new Set(treasuryOwners.map(address => address!.toLowerCase())).size !== 3) {
  throw new Error("Définissez TREASURY_OWNERS avec trois adresses distinctes valides.");
}
if (networkName === "sepolia" && (await ethers.provider.getNetwork()).chainId !== 11155111n) {
  throw new Error("Le RPC configuré n'est pas Sepolia (11155111).");
}
const frontendRpc = process.env.FRONTEND_RPC_URL ?? (networkName === "localhost" ? "http://127.0.0.1:8545" : process.env.SEPOLIA_RPC_URL);
if (!frontendRpc) throw new Error("Définissez FRONTEND_RPC_URL pour le réseau cible.");

const tokenRate = BigInt(process.env.TOKEN_RATE ?? "100");
// 150 blocs à 2 secondes par bloc donnent environ cinq minutes sur Hardhat
// local, assez pour faire voter plusieurs comptes MetaMask pendant la démo.
const votingPeriod = BigInt(process.env.VOTING_PERIOD_BLOCKS ?? "150");
const executionDelay = BigInt(process.env.EXECUTION_DELAY_BLOCKS ?? "5");
// 50% participation by default. Passing additionally requires >50% of the
// snapshotted CFD supply to vote in favour (enforced by CampaignGovernance).
const quorumBps = BigInt(process.env.QUORUM_BPS ?? "5000");
const treasuryThreshold = BigInt(
  process.env.TREASURY_LARGE_WITHDRAWAL_WEI ?? ethers.parseEther("1").toString(),
);

console.log(`Deploying Crowdfund DAO to ${networkName} from ${deployer.address}`);

const token = await ethers.deployContract("CFDToken", [deployer.address]);
await token.waitForDeployment();

const core = await ethers.deployContract("CrowdfundingCore", [
  await token.getAddress(),
  deployer.address,
  tokenRate,
]);
await core.waitForDeployment();

const governance = await ethers.deployContract("CampaignGovernance", [
  await token.getAddress(),
  await core.getAddress(),
  votingPeriod,
  executionDelay,
  quorumBps,
]);
await governance.waitForDeployment();

const treasury = await ethers.deployContract("MultiSigTreasury", [
  treasuryOwners,
  treasuryThreshold,
]);
await treasury.waitForDeployment();

await (await token.grantRole(await token.MINTER_ROLE(), await core.getAddress())).wait();
await (await token.grantRole(await token.BURNER_ROLE(), await core.getAddress())).wait();
await (await core.grantRole(await core.GOVERNANCE_ROLE(), await governance.getAddress())).wait();

const deployment = {
  network: networkName,
  chainId: (await ethers.provider.getNetwork()).chainId.toString(),
  deploymentBlock: (await core.deploymentTransaction()!.wait())!.blockNumber,
  deployer: deployer.address,
  contracts: {
    CFDToken: await token.getAddress(),
    CrowdfundingCore: await core.getAddress(),
    CampaignGovernance: await governance.getAddress(),
    MultiSigTreasury: await treasury.getAddress(),
  },
  parameters: {
    tokenRate: tokenRate.toString(),
    votingPeriodBlocks: votingPeriod.toString(),
    executionDelayBlocks: executionDelay.toString(),
    quorumBps: quorumBps.toString(),
    treasuryThreshold: treasuryThreshold.toString(),
    // Conservés ici parce qu'ils sont des arguments de constructeur : sans eux
    // la vérification du code source sur l'explorateur n'est pas reproductible
    // depuis le seul manifeste.
    treasuryOwners,
  },
};

await mkdir("deployments", { recursive: true });
const outputPath = path.join("deployments", `${networkName}.json`);
await writeFile(outputPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

// Addresses shift whenever the node is restarted or redeployed. Writing the
// front-end env here keeps the interface from silently reading a dead address.
const envPath = path.join("frontend", ".env");

// Le jeton Pinata n'est pas dérivé du déploiement : il est saisi à la main et
// serait perdu à chaque redéploiement si on écrasait le fichier sans le relire.
const previousEnv = await readFile(envPath, "utf8").catch(() => "");
const pinataJwt = process.env.PINATA_JWT ?? previousEnv.match(/^VITE_PINATA_JWT=(.*)$/m)?.[1] ?? "";

const envBody = [
  `VITE_CORE_ADDRESS=${deployment.contracts.CrowdfundingCore}`,
  `VITE_TOKEN_ADDRESS=${deployment.contracts.CFDToken}`,
  `VITE_GOVERNANCE_ADDRESS=${deployment.contracts.CampaignGovernance}`,
  `VITE_TREASURY_ADDRESS=${deployment.contracts.MultiSigTreasury}`,
  `VITE_RPC_URL=${frontendRpc}`,
  `VITE_CHAIN_ID=${deployment.chainId}`,
  `VITE_CHAIN_NAME=${networkName === "localhost" ? "Hardhat Local" : "Sepolia"}`,
  `VITE_DEPLOYMENT_BLOCK=${deployment.deploymentBlock}`,
  `VITE_IPFS_GATEWAY=${process.env.IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs"}`,
  `VITE_PINATA_JWT=${pinataJwt}`,
].join("\n");
await writeFile(envPath, `${envBody}\n`, "utf8");

console.log(JSON.stringify(deployment, null, 2));
console.log(`Deployment manifest written to ${outputPath}`);
console.log(`Front-end addresses written to ${envPath}`);
