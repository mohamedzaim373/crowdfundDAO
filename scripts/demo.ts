import { readFile } from "node:fs/promises";
import hre from "hardhat";

const { ethers, networkName } = await hre.network.create();
const manifest = JSON.parse(await readFile(`deployments/${networkName}.json`, "utf8"));

const [admin, alice, bob] = await ethers.getSigners();
const core = await ethers.getContractAt("CrowdfundingCore", manifest.contracts.CrowdfundingCore);
const token = await ethers.getContractAt("CFDToken", manifest.contracts.CFDToken);

const eth = (value: bigint) => `${ethers.formatEther(value)} ETH`;
const cfd = (value: bigint) => `${ethers.formatEther(value)} CFD`;

// 1. Une campagne de 10 ETH sur 30 jours, au profit de Bob.
const goal = ethers.parseEther("10");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
const campaignId = await core.nextCampaignId();
// CID réel de docs/campagne-exemple.json, calculé par scripts/make-cid.mjs.
const metadataCid = "ipfs://bafkreih33xpwo4wnh7u6c74zvcltj3h3giygigxlmkheqmc4mtmprxmtwy";
await (await core.createCampaign(goal, deadline, bob.address, metadataCid)).wait();

console.log(`\n[1] Campagne #${campaignId} créée par ${admin.address}`);
console.log(`    objectif ${eth(goal)} | bénéficiaire ${bob.address}`);
console.log(`    échéance ${new Date(Number(deadline) * 1000).toLocaleString("fr-FR")}`);
console.log(`    séquestre du Core : ${eth(await ethers.provider.getBalance(await core.getAddress()))}`);

// 2. Alice contribue 3 ETH et reçoit 300 CFD.
await (await core.connect(alice).contribute(campaignId, { value: ethers.parseEther("3") })).wait();

console.log(`\n[2] Alice (${alice.address}) contribue 3 ETH`);
console.log(`    solde CFD d'Alice : ${cfd(await token.balanceOf(alice.address))}`);

// 3. Le vote est pondéré par le solde : la frappe auto-délègue, donc le
//    pouvoir de vote est immédiat et égal au solde, sans démarche préalable.
console.log(`    pouvoir de vote : ${cfd(await token.getVotes(alice.address))}`);

// 4. État final de la campagne.
const campaign = await core.getCampaign(campaignId);
const states = ["Active", "Successful", "Failed", "Frozen", "Cancelled", "PaidOut"];
console.log(`\n[3] État : ${states[Number(await core.campaignStatus(campaignId))]}`);
console.log(`    collecté ${eth(campaign.totalRaised)} / ${eth(campaign.goal)}`);
console.log(`    métadonnées on-chain : ${campaign.metadataHash}`);
console.log(`    ETH détenus par le Core : ${eth(await ethers.provider.getBalance(await core.getAddress()))}`);
console.log(`    offre totale de CFD : ${cfd(await token.totalSupply())}\n`);
