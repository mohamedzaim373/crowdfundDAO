// Déploiement Sepolia en une commande :
//
//   npm run sepolia -- 0xPROPRIETAIRE_1,0xPROPRIETAIRE_2,0xPROPRIETAIRE_3
//
// Enchaîne la vérification des prérequis, l'enregistrement de la clé dans le
// keystore chiffré, la compilation, le déploiement, le contrôle on-chain et la
// publication du code source.
//
// La clé privée n'est jamais lue, affichée ni transmise par ce script : elle
// est saisie directement dans l'invite masquée de `hardhat keystore`, qui
// hérite du terminal. Le script ne voit que des adresses publiques.
import { spawn } from "node:child_process";
import { JsonRpcProvider, formatEther, isAddress, getAddress } from "ethers";

const RPC = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const KEY_LABEL = "SEPOLIA_PRIVATE_KEY";

const run = (cmd, args, extraEnv = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...extraEnv },
    });
    child.on("close", (code) => resolve(code ?? 1));
  });

const step = (n, label) => console.log(`\n\u001b[1m[${n}/6] ${label}\u001b[0m`);
const fail = (message, hint) => {
  console.error(`\n\u001b[31m${message}\u001b[0m`);
  if (hint) console.error(hint);
  process.exit(1);
};

// --- Propriétaires de la trésorerie ------------------------------------------

const raw = process.argv[2] ?? process.env.TREASURY_OWNERS ?? "";
const owners = raw.split(",").map((a) => a.trim()).filter(Boolean);
if (owners.length !== 3) {
  fail(
    `Il faut exactement trois adresses de propriétaires, ${owners.length} fournie(s).`,
    'Exemple :\n  npm run sepolia -- 0xAAA...,0xBBB...,0xCCC...',
  );
}
// Contrôlé avant la validation d'adresse : une clé privée échouerait sinon sur
// le message générique « adresse invalide », alors que la confondre avec une
// adresse est justement l'erreur à signaler explicitement. Une clé fait 64
// caractères hexadécimaux, une adresse 40.
if (owners.some((v) => /^(0x)?[0-9a-fA-F]{64}$/.test(v))) {
  fail(
    "Un des arguments ressemble à une CLÉ PRIVÉE, pas à une adresse.",
    "Ne mets jamais une clé privée sur la ligne de commande : elle serait enregistrée\n" +
      "en clair dans l'historique du shell, et le compte serait à considérer comme perdu.\n" +
      "Ce script attend trois adresses publiques (0x suivi de 40 caractères).\n" +
      "La clé se saisit uniquement dans l'invite masquée, à l'étape 2.",
  );
}

const invalid = owners.filter((a) => !isAddress(a));
if (invalid.length > 0) fail(`Adresse invalide : ${invalid.join(", ")}`);
if (new Set(owners.map((a) => a.toLowerCase())).size !== 3) {
  fail("Les trois propriétaires doivent être distincts (trésorerie 2-sur-3).");
}
const checksummed = owners.map((a) => getAddress(a));

// --- 1. Prérequis on-chain ----------------------------------------------------

step(1, "Contrôle des prérequis sur Sepolia");
const provider = new JsonRpcProvider(RPC);
const chainId = (await provider.getNetwork()).chainId;
if (chainId !== 11155111n) fail(`Le RPC ${RPC} répond pour la chaîne ${chainId}, pas Sepolia (11155111).`);
console.log(`RPC ${RPC} — chaîne ${chainId} confirmée`);

for (const [i, address] of checksummed.entries()) {
  const balance = await provider.getBalance(address);
  console.log(`  propriétaire ${i + 1} : ${address} — ${formatEther(balance)} ETH`);
}
const deployerBalance = await provider.getBalance(checksummed[0]);
provider.destroy();

// Le déploiement mesuré coûte 6 431 249 gas ; même à un prix de gas élevé pour
// Sepolia, 0,001 ETH laisse une marge très confortable.
if (deployerBalance < 10n ** 15n) {
  fail(
    `Le premier propriétaire ${checksummed[0]} n'a que ${formatEther(deployerBalance)} ETH.`,
    "C'est lui qui déploie et qui paie le gas. Alimente-le depuis un faucet Sepolia,\n" +
      "par exemple https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  );
}

// --- 2. Clé de déploiement ----------------------------------------------------

step(2, "Clé de déploiement");
if (process.env[KEY_LABEL]) {
  console.log(`${KEY_LABEL} est présente dans l'environnement : elle sera utilisée.`);
} else {
  const listed = await new Promise((resolve) => {
    let out = "";
    const child = spawn("npx", ["hardhat", "keystore", "list"], { shell: true });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => resolve(out));
  });

  if (listed.includes(KEY_LABEL)) {
    console.log("Clé déjà présente dans le keystore chiffré.");
  } else {
    console.log("Aucune clé enregistrée. Hardhat va la demander maintenant.");
    console.log("\n  Colle la clé privée du compte " + checksummed[0]);
    console.log("  Rien ne s'affichera pendant le collage : c'est voulu.");
    console.log("  Hardhat demandera ensuite un mot de passe pour la chiffrer.\n");
    const code = await run("npx", ["hardhat", "keystore", "set", KEY_LABEL]);
    if (code !== 0) fail("Enregistrement de la clé interrompu.");
  }
}

// --- 3 à 6. Compilation, déploiement, contrôles -------------------------------

const env = {
  SEPOLIA_RPC_URL: RPC,
  FRONTEND_RPC_URL: process.env.FRONTEND_RPC_URL ?? RPC,
  TREASURY_OWNERS: checksummed.join(","),
  // Sepolia produit un bloc toutes les ~12 s : 25 blocs ≈ 5 min de vote.
  VOTING_PERIOD_BLOCKS: process.env.VOTING_PERIOD_BLOCKS ?? "25",
  EXECUTION_DELAY_BLOCKS: process.env.EXECUTION_DELAY_BLOCKS ?? "2",
};

step(3, "Compilation et export des ABI");
if ((await run("npm", ["run", "build"], env)) !== 0) fail("La compilation a échoué.");

step(4, "Déploiement sur Sepolia");
if ((await run("npm", ["run", "deploy:sepolia"], env)) !== 0) {
  fail("Le déploiement a échoué.", "Rien n'a été écrit si aucune adresse ne s'est affichée.");
}

step(5, "Contrôle des contrats déployés");
if ((await run("npm", ["run", "verify:sepolia"], env)) !== 0) {
  console.error("\nDes contrôles on-chain ont échoué : lis le détail ci-dessus avant de continuer.");
}

step(6, "Publication du code source");
// Sourcify et Blockscout ne demandent aucune clé ; un échec ici n'invalide pas
// le déploiement lui-même, qui est déjà acquis.
await run("npm", ["run", "verify:source", "--", "sepolia"], env);

console.log("\n\u001b[32mTerminé.\u001b[0m Adresses dans deployments/sepolia.json.");
console.log("Redémarre le front (npm run frontend:dev) pour qu'il lise le nouveau réseau.");
