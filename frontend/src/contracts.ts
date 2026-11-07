import coreAbi from "./generated/CrowdfundingCore.json";
import tokenAbi from "./generated/CFDToken.json";
import governanceAbi from "./generated/CampaignGovernance.json";
import treasuryAbi from "./generated/MultiSigTreasury.json";
export { coreAbi, tokenAbi, governanceAbi, treasuryAbi };

export const addresses = {
  core: import.meta.env.VITE_CORE_ADDRESS ?? "",
  token: import.meta.env.VITE_TOKEN_ADDRESS ?? "",
  governance: import.meta.env.VITE_GOVERNANCE_ADDRESS ?? "",
  treasury: import.meta.env.VITE_TREASURY_ADDRESS ?? "",
};

// Lecture directe du nœud : l'affichage ne dépend donc ni d'un wallet installé,
// ni du réseau actuellement sélectionné dans MetaMask.
export const rpcUrl = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";

// ipfs.io et dweb.link imposent un quota par adresse IP et répondent 429 depuis
// un réseau partagé. La passerelle est donc configurable.
export const ipfsGateway = (
  import.meta.env.VITE_IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs"
).replace(/\/+$/, "");

export const isConfigured = Object.values(addresses).every(
  (address) => address && !/^0x0{40}$/i.test(address),
);


export const expectedChainId = BigInt(import.meta.env.VITE_CHAIN_ID ?? "31337");
export const chainName = import.meta.env.VITE_CHAIN_NAME ?? "Hardhat Local";

// Bloc de déploiement du Core : les recherches d'évènements partent de là.
// Un RPC public (Sepolia) refuse souvent une plage démarrant au bloc 0.
const rawDeploymentBlock = Number(import.meta.env.VITE_DEPLOYMENT_BLOCK ?? "0");
export const deploymentBlock =
  Number.isInteger(rawDeploymentBlock) && rawDeploymentBlock > 0 ? rawDeploymentBlock : 0;
