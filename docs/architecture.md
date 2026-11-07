# Architecture corrigée

Le contributeur appelle CrowdfundingCore, qui séquestre les ETH et crée les CFD dans CFDToken. CFDToken auto-délègue chaque adresse à la réception, si bien que le pouvoir de vote vaut le solde sans action du détenteur ; CampaignGovernance fige les poids avant proposition et autorise le paiement ou le gel. MultiSigTreasury gère une trésorerie séparée à trois propriétaires.

## Paramètres et choix

Hardhat réunit la compilation, les tests isolés et le déploiement dans la pile TypeScript du front. Le taux fixe 100 CFD/ETH simplifie la lecture sans modifier la proportion relative des contributions. Le quorum exige 50 % de participation et l’adoption exige strictement plus de 50 % de toute l’offre CFD figée au snapshot en votes « Pour ». Une minorité active ne peut donc pas décider seule : avec cinq détenteurs de poids égal, trois votes favorables sont nécessaires.

## Cycle de vie

Active permet la collecte jusqu’à l’objectif ou, au plus tard, jusqu’à l’échéance. La dernière contribution est plafonnée au montant restant : le contrat refuse tout dépassement. Successful apparaît immédiatement lorsque l’objectif est atteint ; Failed apparaît à l’échéance si l’objectif reste incomplet. Frozen, Cancelled et PaidOut sont persistants. Une approbation anticipée ferme aussi la collecte et marque la campagne Successful. Tous les retraits exigent une approbation exécutée, puis la signature du bénéficiaire.

Les CFD restent verrouillés jusqu’à PaidOut ; les remboursements les détruisent intégralement. Un appel individuel releaseContributionTokens débloque les CFD après paiement, une seule fois, sans boucle dans le retrait. Le champ historique earlyReleaseApproved représente désormais l’autorisation de paiement, anticipée ou finale.

## Interface, métadonnées et exécution

Les ABI sont exportées depuis les artefacts compilés. L’interface lit via le RPC du déploiement et signe via MetaMask après vérification du chainId. Un rafraîchissement toutes les quatre secondes reflète les actions d’autres comptes. Les formulaires conservent leurs valeurs après un refus ou un échec de transaction.

Le CID stocké on-chain identifie le JSON IPFS ; l’interface en valide les champs et utilise une couverture de repli si l’image est inaccessible.

Aucun contenu éditorial n’est écrit dans la blockchain : les campagnes y conservent `metadataHash` et les propositions `descriptionHash`, deux URI `ipfs://`. L’interface publie elle-même ces documents via Pinata (`VITE_PINATA_JWT`), de sorte que l’utilisateur saisit son texte et son image sans manipuler de CID. Sans jeton configuré, les champs concernés basculent sur la saisie d’un CID déjà publié, afin que le projet reste utilisable sans compte tiers.

Le motif d’une proposition suit donc la même règle que la fiche d’une campagne : la chaîne n’en garde que l’empreinte, et toute réécriture ultérieure du texte produirait un CID différent de celui inscrit au moment du vote.

scripts/keeper.mjs automatise les décisions locales et active le minage périodique. Il ne décide pas de l’issue du vote et n’exécute pas de transfert au bénéficiaire à sa place. Une exécution sur réseau public demande un service distinct ou un appel manuel.

## Captures du déploiement Sepolia

Déploiement du 7 novembre 2026 sur la chaîne 11155111, bloc 12085541, depuis `0x568e84bB2690Dd0c4cd9b33465412C70D63901E7`.

| Fichier | Contenu |
|---|---|
| `screenshots/sepolia-01-deploiement-transactions.jpg` | Les huit transactions du déployeur : quatre créations de contrats, trois attributions de rôles, et l'alimentation du faucet. |
| `screenshots/sepolia-02-sourcify-exact-match.jpg` | Vérification Sourcify de CFDToken en correspondance exacte, bytecode de création et d'exécution. |
| `screenshots/sepolia-03-cfdtoken.jpg` | CFDToken sur Etherscan Sepolia. |
| `screenshots/sepolia-04-crowdfundingcore.jpg` | CrowdfundingCore sur Etherscan Sepolia. |
| `screenshots/sepolia-05-campaigngovernance.jpg` | CampaignGovernance sur Etherscan Sepolia. |
| `screenshots/sepolia-06-multisigtreasury.jpg` | MultiSigTreasury sur Etherscan Sepolia. |
| `screenshots/sepolia-07-dapp-reseau.jpg` | L'interface servie sur la configuration Sepolia, avant toute campagne. |
| `sepolia-verification.txt` | Sortie de `npm run verify:sepolia` : trente contrôles de paramètres, de câblage et de rôles, tous au vert. |

Les captures montrant une campagne créée, une contribution et un vote exigent une signature MetaMask et restent à produire manuellement.
