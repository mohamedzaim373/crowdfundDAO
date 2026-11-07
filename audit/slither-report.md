# Analyse statique — contrats finaux

Slither 0.11.6 : **41 contrats, 102 détecteurs, 8 findings**. Fichier brut de référence : `audit/slither-final-2026-11-07.json` (champ `success` à `true`). Le code de sortie 1 reflète les findings, pas un échec de l'analyse.

## Historique des exécutions

| Date | Contrats analysés | Findings | High | Medium |
|---|---|---:|---:|---:|
| 2026-11-04 | avant refactor gouvernance | 8 | 0 | 1 |
| 2026-11-06 | motif de proposition hors-chaîne | 8 | 0 | 1 |
| **2026-11-07** | **contrats finaux** | **8** | **0** | **1** |

La deuxième exécution fait suite au passage du motif de proposition hors-chaîne : `CampaignGovernance.description` (texte intégral stocké on-chain) est devenu `descriptionHash` (URI IPFS), avec l'erreur `EmptyDescriptionHash` qui refuse une proposition sans motif publié.

La troisième exécution fait suite à l'alignement du vote sur le module M3 : suppression de la délégation, auto-délégation à la réception dans `CFDToken._update`, neutralisation de `delegate` et `delegateBySig`, et retrait de l'extension `ERC20Permit` inutilisée. Le nombre de contrats analysés passe de 43 à 41 pour cette raison.

Le diff des rapports JSON ne montre **aucune régression** sur les trois exécutions : le profil reste 1 Medium, 4 Low et 3 Informational, aux mêmes emplacements fonctionnels. Aucun détecteur n'a été déclenché par le code ajouté, ni par la comparaison `bytes(descriptionHash).length == 0`, ni par l'auto-délégation insérée dans `_update`.

## Reproduction

```powershell
npx hardhat clean
npm run build
python -m pip install slither-analyzer
python -m slither . --hardhat-ignore-compile --filter-paths 'node_modules|contracts/test' --json audit/nouvelle-analyse.json
```

Le nettoyage évite les doublons d'anciennes unités de compilation dans les artefacts Hardhat. Choisir un fichier de sortie inexistant : Slither refuse d'écraser.

`contracts/test` est exclu volontairement : `ReentrancyAttacker` est un contrat d'attaque écrit pour la suite de tests, dont les findings ne concernent pas le livrable.

## Triage final

| Détecteur | Niveau outil | Nombre | Analyse contextuelle |
|---|---|---:|---|
| incorrect-equality | Medium | 1 | `getPastVotes(...) == 0` teste l'éligibilité exacte à proposer. Ce n'est pas une égalité sur un prix ou un solde ETH, cas que vise le détecteur ; faux positif contextuel. |
| timestamp | Low | 4 | Échéances de création, de contribution, de déblocage anticipé et de calcul de statut. Usage attendu du temps de bloc ; la marge de manipulation d'un validateur (quelques secondes) est sans effet sur des échéances exprimées en jours. |
| low-level-calls | Informational | 3 | Retrait, remboursement et trésorerie. Les trois sites appliquent Checks-Effects-Interactions, contrôlent la valeur de retour et sont protégés par `ReentrancyGuard`. `call` est ici préférable à `transfer` : il ne plafonne pas le gas à 2300, ce qui casserait les bénéficiaires de type contrat. |

Aucune alerte High. L'absence d'alerte n'est pas une preuve générale de sûreté.

## Corrections vérifiées par tests

- Suppression du burn partiel : les CFD remboursables restent verrouillés puis sont détruits intégralement. Les cycles financement / transfert tenté / remboursement ne créent plus de voix gratuites.
- Paiement normal et anticipé soumis à une approbation DAO exécutée ; retrait sans vote refusé.
- Refus du déblocage anticipé après l'échec d'une campagne.
- Déblocage des CFD transférables seulement après paiement, une fois par campagne et par contributeur.
- Remboursement possible pendant la pause du jeton si le Core est actif.
- Séparation stricte entre le dernier bloc de vote et l'exécution, y compris avec un délai configuré à zéro.
- Maintien des protections de trésorerie : deux signatures pour les appels porteurs de données même sans ETH, et au-delà du seuil.
- Motif de proposition obligatoire : `EmptyDescriptionHash` empêche d'inscrire une décision que les votants n'auraient aucun moyen de juger, le texte ne vivant plus on-chain.

La suite courante comporte **39 tests réussis** (`npm run test:contracts`), dont une attaque par réentrance exécutée contre `refund`, une régression prouvant qu’une minorité de détenteurs ne peut plus adopter seule une proposition et un test empêchant le dépassement de l’objectif. Un exécuteur local applique les décisions éligibles et refuse les réseaux publics. Les contrats analysés ici sont ceux déployés sur Sepolia (CFDToken 0x95FDb2b1f16cCF4648FE29647bB1eC4BCd025003), code source publié sur Sourcify en correspondance exacte. Aucun audit indépendant n'est revendiqué.
