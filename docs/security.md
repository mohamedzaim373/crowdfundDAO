# Sécurité - version corrigée du 4 novembre 2026

## Réentrance et autorisations

Le Core et la trésorerie utilisent ReentrancyGuard et Checks-Effects-Interactions sur les sorties ETH. L’état est modifié avant l’appel externe et son résultat est vérifié. Un contrat hostile simule une réentrance de remboursement ; l’attaque est bloquée.

AccessControl sépare les rôles d’administration, de pause, de mint, de burn et de gouvernance. Tout paiement au bénéficiaire exige une proposition DAO exécutée. L’atteinte de l’objectif seule n’autorise plus de retrait. L’administration initiale peut réattribuer les rôles : elle reste une hypothèse de confiance.

## Jetons et remboursement

Les CFD des contributions sont verrouillés par détenteur jusqu’au paiement de leur campagne. Ils permettent de voter mais transfer et transferFrom ne peuvent déplacer la partie verrouillée. Chaque remboursement brûle exactement les CFD de la contribution. Le capital remboursé ne laisse donc aucune nouvelle voix en circulation.

Après PaidOut, releaseContributionTokens libère les jetons d’un contributeur, une seule fois par campagne, sans boucle sur tous les participants. Les CFD devenus transférables peuvent rester en circulation : ils correspondent à une campagne effectivement payée.

La pause du Core bloque contributions, créations, remboursements et retraits. La pause du jeton bloque mint et transferts mais laisse le burn autorisé fonctionner : elle ne bloque pas un remboursement si le Core est actif. La reprise du Core reste une décision du rôle de pause.

## Gouvernance

Le poids d’un votant est son solde de CFD, conformément au module M3 du cahier des charges. CFDToken auto-délègue chaque adresse dès sa première réception, et `delegate` comme `delegateBySig` révertent sur `DelegationDisabled`. Le pouvoir de vote ne peut donc ni rester inactif faute d’une démarche préalable, ni être cédé indépendamment des jetons : il naît avec la frappe, suit le transfert et disparaît avec le burn. Les checkpoints ERC20Votes restent utilisés, car ce sont eux qui rendent possible le vote sur solde figé.

Les poids et l’offre totale sont lus au bloc précédant la proposition. Le quorum vaut 50 % de l’offre historique et la majorité est absolue : les voix « Pour » doivent dépasser 50 % de cette même offre. Les abstentions empêchent ainsi une petite minorité de faire adopter seule une décision. Avec cinq détenteurs de poids égal, trois votes favorables sont nécessaires. Le déploiement local laisse le vote ouvert 150 blocs, soit environ cinq minutes avec le keeper à un bloc toutes les deux secondes, puis attend 5 blocs supplémentaires avant exécution. Un bloc sépare toujours la fin du vote de la première exécution possible. Les tests rapides emploient une période réduite et vérifient aussi le délai configuré à zéro.

La fenêtre se compte en blocs, pas en secondes : elle doit donc être réglée par réseau. Sepolia produit un bloc toutes les douze secondes environ, contre deux secondes pour le keeper local. Le déploiement Sepolia utilise 25 blocs de vote et 2 blocs de délai, ce qui redonne les mêmes ordres de grandeur en temps réel, environ cinq minutes de vote puis une demi-minute d'attente. Le quorum et la majorité restent inchangés : seule la durée est adaptée au rythme du réseau.

Trois actions existent : déblocage anticipé, gel et validation du retrait final. Le déblocage anticipé est refusé après échéance d’une campagne échouée. L’approbation ferme la collecte et autorise le paiement, même sous l’objectif dans le cas anticipé.

Le keeper automatise l’exécution uniquement sur Hardhat local et refuse les réseaux publics. Il utilise un compte local déverrouillé, sans lire de clé privée. Le bouton manuel reste disponible. Un service d’exécution public est une responsabilité opérationnelle distincte.

## Trésorerie

Trois propriétaires distincts. Deux confirmations au-delà de 1 ETH et pour tout appel portant des données, même à valeur ETH nulle. Les confirmations sont révocables et une transaction ne peut être exécutée qu’une fois. La trésorerie est distincte du séquestre : une campagne doit la choisir comme bénéficiaire pour y verser ses fonds.

## Limites

Le snapshot ne supprime pas la domination par un détenteur important ni les voix historiques d’une décision déjà ouverte. L’administrateur initial conserve des privilèges importants ; les transférer à une autorité collective avant un usage réel. Les CFD ne sont pas librement transférables pendant la phase remboursable : cette restriction est un choix explicite. IPFS exige un épinglage durable. Les contrats ne sont pas upgradeables. Le fuzzing présent n’est pas exhaustif et aucun audit indépendant n’est revendiqué.
