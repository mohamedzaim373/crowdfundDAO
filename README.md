# Crowdfund DAO 

Copie de référence : `C:/Users/thund/Downloads/block chaine`. La copie OneDrive est antérieure. Le rapport actualisé est `output/pdf/rapport_blockchain_corrige.pdf` (10 pages) ; son source reproductible est `scripts/build-report.py`.

## Fonctionnement

- Une contribution de 1 ETH crée 100 CFD. Le poids du vote est le solde de CFD : le jeton auto-délègue à la réception, et la délégation à un tiers est désactivée.
- La collecte se ferme dès que l’objectif est atteint ; le contrat refuse tout dépassement et la durée sert d’échéance maximale si l’objectif n’est pas encore atteint.
- Les CFD issus d’une contribution restent non transférables tant que celle-ci peut être remboursée. Un remboursement détruit exactement tous les CFD associés.
- Tout paiement exige une décision DAO exécutée, y compris lorsque l’objectif est atteint.
- Une proposition exige 50 % de participation et plus de 50 % de toute l’offre CFD snapshot en votes « Pour » ; avec cinq détenteurs égaux, trois votes favorables sont nécessaires.
- Après paiement, le contributeur peut cliquer sur « Rendre mes CFD transférables ».
- La trésorerie exige deux propriétaires sur trois au-delà de 1 ETH et pour tout appel comportant des données.

## Démarrage local

Node.js 22.13 ou supérieur, Python 3 et MetaMask pour signer depuis le navigateur.

```powershell
npm install
npm run check
```

Dans des terminaux distincts :

```powershell
npm run node
```

```powershell
npm run deploy:local
npm run demo:local
```

```powershell
npm run keeper:local
```

```powershell
npm run frontend:dev
```

Ouvrir http://127.0.0.1:5173. MetaMask : RPC `http://127.0.0.1:8545`, chaîne `31337`, compte de développement Hardhat. Utiliser exclusivement les clés de test locales.

Le déploiement écrit `deployments/localhost.json` et `frontend/.env`. Le build exporte les ABI compilées dans `frontend/src/generated`. Après redémarrage du nœud, redéployer les contrats et redémarrer le keeper. Un redéploiement crée de nouvelles adresses et ne migre pas les campagnes précédentes.

Le keeper local produit un bloc toutes les deux secondes et exécute les propositions adoptées après leur délai. Il refuse les réseaux publics. L’interface relit l’état toutes les quatre secondes. Sans keeper, le bouton « Exécuter » permet une exécution manuelle ; attendre du temps réel ne produit pas de blocs avec le réglage Hardhat initial.

## Parcours de démonstration

1. Créer une campagne avec le CID ci-dessous et contribuer depuis deux comptes.
2. Constater que le pouvoir de vote est disponible dès la contribution, sans action préalable ; vérifier que les CFD remboursables ne peuvent pas être transférés.
3. Proposer un déblocage anticipé ou un gel. Pour une campagne réussie à l’échéance, choisir « Validation du retrait final ».
4. Voter ; observer l’exécution par le keeper après le délai.
5. Le bénéficiaire retire après approbation ; les contributeurs peuvent alors débloquer leurs CFD.
6. Pour une campagne échouée, gelée ou annulée : remboursement et destruction exacte des CFD.
7. Montrer les tests de pause, réentrance et multisignature.

CID fourni : `bafkreih33xpwo4wnh7u6c74zvcltj3h3giygigxlmkheqmc4mtmprxmtwy`. Il est prérempli dans le formulaire et utilisé par `npm run demo:local`.

## Tests 

`npm run check` vérifie les contrats, les **39 tests**, TypeScript et le build Vite. La recette de signature réelle dans MetaMask reste à réaliser par l’équipe.

```powershell
npm run analyze:local
```

Cette commande exporte les véritables événements de contribution puis exécute les heuristiques Python. Les résultats sont `audit/contributions.json` et `audit/anomalies.json`. Une alerte est un signal à examiner, jamais une preuve de fraude.

Pour Slither, avec l’environnement Python contenant `slither-analyzer` :

```powershell
$env:VIRTUAL_ENV=(Resolve-Path '.venv').Path
./.venv/Scripts/python.exe -m slither . --hardhat-ignore-compile --filter-paths 'node_modules|contracts/test' --json audit/nouvelle-analyse.json
```

Choisir un nom de sortie inexistant. Après modification des contrats, exécuter `npm run build` ; si des artefacts anciens perturbent Slither, utiliser `npx hardhat clean` puis reconstruire. Le code de sortie 1 indique des findings ; consulter aussi le champ `success` du JSON.

## Sepolia

### Déploiement en service

Chaîne 11155111, bloc 12085541, déployé depuis `0x568e84bB2690Dd0c4cd9b33465412C70D63901E7`.

| Contrat | Adresse | Explorateur |
|---|---|---|
| CFDToken | `0x95FDb2b1f16cCF4648FE29647bB1eC4BCd025003` | [Etherscan](https://sepolia.etherscan.io/address/0x95FDb2b1f16cCF4648FE29647bB1eC4BCd025003) · [Sourcify](https://sourcify.dev/server/repo-ui/11155111/0x95FDb2b1f16cCF4648FE29647bB1eC4BCd025003) |
| CrowdfundingCore | `0x3371A6C82173d21d8D214cBe5045227Ec048fC15` | [Etherscan](https://sepolia.etherscan.io/address/0x3371A6C82173d21d8D214cBe5045227Ec048fC15) · [Sourcify](https://sourcify.dev/server/repo-ui/11155111/0x3371A6C82173d21d8D214cBe5045227Ec048fC15) |
| CampaignGovernance | `0x64964d2bc8419F19D20421CBcFB473494b1b03ed` | [Etherscan](https://sepolia.etherscan.io/address/0x64964d2bc8419F19D20421CBcFB473494b1b03ed) · [Sourcify](https://sourcify.dev/server/repo-ui/11155111/0x64964d2bc8419F19D20421CBcFB473494b1b03ed) |
| MultiSigTreasury | `0x4652D5c4adaEcC7bc13d021cdD45e7c604Ed7D56` | [Etherscan](https://sepolia.etherscan.io/address/0x4652D5c4adaEcC7bc13d021cdD45e7c604Ed7D56) · [Sourcify](https://sourcify.dev/server/repo-ui/11155111/0x4652D5c4adaEcC7bc13d021cdD45e7c604Ed7D56) |

Les quatre contrats sont vérifiés sur Sourcify en correspondance exacte (`exact_match`), sur le bytecode de création comme sur le bytecode d’exécution. Fenêtre de vote de 25 blocs et délai d’exécution de 2 blocs, adaptés au rythme de Sepolia. Contrôler à tout moment avec `npm run verify:sepolia`.

### Refaire un déploiement

Il exige un RPC Sepolia, une clé de test et trois adresses distinctes de propriétaires.

**En une commande.** Depuis le dossier `Crowdfund_DAO`, avec les trois adresses de propriétaires en argument :

```powershell
npm run sepolia -- 0xPROPRIETAIRE_1,0xPROPRIETAIRE_2,0xPROPRIETAIRE_3
```

Le script contrôle le RPC et le solde du déployeur, demande la clé dans une invite masquée si le keystore est vide, puis enchaîne compilation, déploiement, contrôle on-chain et publication du code source. Il refuse une clé privée passée en argument. Les sections ci-dessous détaillent les mêmes étapes une par une.

**Méthode recommandée — keystore chiffré.** La clé est saisie une seule fois dans une invite masquée, chiffrée par un mot de passe, et ne transite jamais par l’environnement ni par l’historique du shell :

```powershell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
$env:SEPOLIA_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
$env:TREASURY_OWNERS='0xADRESSE_1,0xADRESSE_2,0xADRESSE_3'
$env:FRONTEND_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
$env:VOTING_PERIOD_BLOCKS='25'
$env:EXECUTION_DELAY_BLOCKS='2'
npm run build
npm run deploy:sepolia
```

Le déploiement demande alors le mot de passe du keystore. Seule la clé y est stockée ; le RPC, les propriétaires et les durées ne sont pas secrets et restent des variables de processus.

**Méthode alternative — variables de processus uniquement.** La clé est lue en priorité dans `SEPOLIA_PRIVATE_KEY` si cette variable existe, ce qui court-circuite le keystore :

```powershell
$env:SEPOLIA_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
$env:SEPOLIA_PRIVATE_KEY='CLE_PRIVEE_DE_TEST'
$env:TREASURY_OWNERS='ADRESSE_1,ADRESSE_2,ADRESSE_3'
$env:FRONTEND_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
$env:VOTING_PERIOD_BLOCKS='25'
$env:EXECUTION_DELAY_BLOCKS='2'
npm run build
npm run deploy:sepolia
```

Après le déploiement, contrôler la chaîne avec `npm run verify:sepolia` (ou `npm run verify:local`). Le script relit les contrats depuis un RPC public, sans aucune clé, et compare les paramètres, le câblage et les rôles au manifeste écrit par `deploy.ts`.

Publier ensuite le code source en regard des adresses :

```powershell
npm run verify:source -- sepolia
```

Les arguments de constructeur sont reconstitués depuis `deployments/sepolia.json`, y compris les trois propriétaires de la trésorerie. **Sourcify** et **Blockscout** ne demandent aucune clé. Pour obtenir en plus la pastille verte d'Etherscan, définir `$env:ETHERSCAN_API_KEY` avant de lancer la commande : sans cette variable, Etherscan est simplement désactivé. La vérification du code source n'est pas exigée par le cahier des charges ; elle rend les captures d'écran du déploiement nettement plus convaincantes.

Un RPC public suffit : aucune clé Alchemy ou Infura n'est nécessaire. Les durées sont réglées pour Sepolia, où un bloc tombe toutes les douze secondes environ : 25 blocs donnent environ cinq minutes de vote, contre 150 blocs en local où le keeper produit un bloc toutes les deux secondes. `FRONTEND_RPC_URL` est repris tel quel dans le bundle du navigateur : y placer un RPC public, jamais une URL contenant une clé d'API.

Ne pas enregistrer les vraies valeurs dans Git ou dans le rapport. Le script refuse une chaîne différente de Sepolia, vérifie les propriétaires et configure automatiquement le réseau du front. `FRONTEND_RPC_URL` peut désigner un RPC public distinct si nécessaire. Les variables `.env.example` ne sont pas chargées automatiquement : les définir dans l’environnement du processus.

Le keeper fourni reste réservé au local. Sur Sepolia, les propositions peuvent être exécutées manuellement ou nécessitent un service opérateur distinct. Vérifier le RPC exposé au navigateur avant de publier le front.

## Documentation

- `docs/architecture.md` : modèle et paramètres.
- `docs/security.md` : protections et limites.
- `audit/slither-report.md` : findings et corrections.
- `audit/corrections-2026-11-04.md` : bilan de la correction.
- `output/pdf/rapport_blockchain_corrige.pdf` : rapport technique actualisé de 10 pages.
