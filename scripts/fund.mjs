#!/usr/bin/env node
// Crédite une adresse en ETH fictif sur le nœud Hardhat local.
//
//   node scripts/fund.mjs 0xVotreAdresseMetaMask        → 1000 ETH
//   node scripts/fund.mjs 0xVotreAdresseMetaMask 50     → 50 ETH
//
// `hardhat_setBalance` fixe le solde au lieu de l'additionner : relancer la
// commande ne cumule pas. Le solde est perdu au redémarrage du nœud, il suffit
// de rejouer la commande.

const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method} : ${payload.error.message}`);
  return payload.result;
}

const address = process.argv[2];
const amount = process.argv[3] ?? "1000";

if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
  console.error("usage: node scripts/fund.mjs <adresse 0x…> [montant en ETH]");
  process.exit(1);
}

// Le nœud attend une quantité hexadécimale en wei, sans zéro de tête superflu.
const wei = BigInt(Math.round(Number(amount) * 1e6)) * 10n ** 12n;

try {
  const chainId = await rpc("eth_chainId", []);
  if (BigInt(chainId) !== 31337n) {
    // Un setBalance n'existe que sur un nœud de développement : si la cible
    // répond autre chose, mieux vaut s'arrêter que d'échouer obscurément.
    console.error(`Chaîne ${BigInt(chainId)} inattendue sur ${rpcUrl} : ce script vise le nœud Hardhat local (31337).`);
    process.exit(1);
  }

  await rpc("hardhat_setBalance", [address, `0x${wei.toString(16)}`]);
  const balance = BigInt(await rpc("eth_getBalance", [address, "latest"]));
  console.log(`${address} → ${Number(balance) / 1e18} ETH`);
} catch (error) {
  console.error(`Échec : ${error.message}`);
  console.error(`Le nœud est-il démarré ? (npx hardhat node) — RPC visé : ${rpcUrl}`);
  process.exit(1);
}
