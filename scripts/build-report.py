"""Build the verified 10-page report with the bundled PDF runtime."""
from pathlib import Path
import json
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, Flowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/rapport_blockchain_corrige.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='ArialBold', italic='Arial', boldItalic='ArialBold')
GREEN = HexColor('#087f5b')
INK = HexColor('#18352c')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyCustom', fontName='Arial', fontSize=10.5, leading=15, textColor=INK, spaceAfter=10))
styles.add(ParagraphStyle(name='TitleCustom', fontName='ArialBold', fontSize=28, leading=34, textColor=INK, spaceAfter=18))
styles.add(ParagraphStyle(name='HeadCustom', fontName='ArialBold', fontSize=20, leading=26, textColor=GREEN, spaceAfter=17))
styles.add(ParagraphStyle(name='SubCustom', fontName='ArialBold', fontSize=12, leading=17, textColor=GREEN, spaceBefore=6, spaceAfter=8))
styles.add(ParagraphStyle(name='CellCustom', fontName='Arial', fontSize=9, leading=12, textColor=INK, wordWrap='CJK'))
styles.add(ParagraphStyle(name='SmallCustom', fontName='Arial', fontSize=8.5, leading=12, textColor=INK, spaceAfter=8, wordWrap='CJK'))
story = []
def p(text, kind='BodyCustom'):
    story.append(Paragraph(text, styles[kind]))
def heading(num, text):
    if story: story.append(PageBreak())
    p(f'{num:02d} / CROWDFUND DAO', 'SmallCustom')
    p(text, 'HeadCustom')
def table(headers, rows, widths):
    data = [[Paragraph(escape(str(v)), styles['CellCustom']) for v in row] for row in [headers] + rows]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#d9f2e7')), ('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8), ('TOPPADDING',(0,0),(-1,-1),7), ('BOTTOMPADDING',(0,0),(-1,-1),7), ('LINEBELOW',(0,0),(-1,0),1,GREEN), ('LINEBELOW',(0,1),(-1,-1),0.4,HexColor('#dbe5df'))]))
    story.append(t); story.append(Spacer(1,12))
def screenshot(name, caption, width=495):
    from PIL import Image as PILImage
    path = ROOT / 'docs/screenshots' / name
    with PILImage.open(path) as im: height = width * im.height / im.width
    story.append(Image(str(path), width=width, height=height))
    p(caption, 'SmallCustom')

heading(1, 'Plateforme de financement participatif à gouvernance par jeton')
p('Crowdfund DAO', 'TitleCustom')
p('Rapport technique corrigé<br/>Module Blockchain - ENSA Beni Mellal<br/>Version vérifiée le 4 novembre 2026')
p('Objet et résultat', 'SubCustom')
p('Le système collecte des ETH dans des campagnes, crée des jetons CFD proportionnels aux contributions et soumet les paiements à une décision de gouvernance. Quatre contrats séparent le jeton, le séquestre, le vote et la trésorerie multisignature. Cette version corrige deux écarts majeurs : la conservation de voix après remboursement et le retrait d’une campagne réussie sans autorisation de la DAO.')
p('La version corrigée passe 39 tests automatisés. Le front-end compile, les métadonnées du CID fourni sont chargées et une proposition de démonstration a été exécutée automatiquement sur Hardhat local. Les quatre contrats sont de plus déployés sur le testnet Sepolia (chaîne 11155111), bloc 12085541, et leur code source y est publié sur Sourcify en correspondance exacte. Le rapport ne présente pas les signatures réelles dans MetaMask comme réalisées.')
table(['Lecture du rapport', 'Pages'], [('Exigences et périmètre', '2'), ('Architecture et rôles', '3'), ('Jeton et remboursement', '4'), ('Cycle de vie et retraits', '5'), ('Gouvernance et automatisation', '6'), ('Sécurité', '7'), ('Tests et audit statique', '8'), ('Déploiement et capture', '9'), ('Recette, bonus et limites', '10')], [380,115])
p('Copie de référence : C:/Users/thund/Downloads/block chaine. La copie OneDrive contient une version antérieure et ne doit pas être confondue avec la version exécutée.', 'SmallCustom')

heading(2, 'Exigences et périmètre')
p('Le cahier des charges impose une dApp multi-contrats en Solidity, un jeton ERC-20 OpenZeppelin, une collecte en ETH, des votes pondérés avec snapshot et des mécanismes de sécurité. La démonstration sur blockchain locale Hardhat est explicitement autorisée. Les obligations sont mises en correspondance avec le code ci-dessous.')
table(['Exigence', 'Implémentation corrigée'], [
('M1 - Jeton CFD', 'ERC20 et ERC20Votes ; 100 CFD par ETH ; mint automatique ; poids de vote egal au solde.'),
('M2 - Campagnes', 'Création, contribution, statuts, remboursement et paiement au bénéficiaire.'),
('M2 - Validation du retrait', 'Toute sortie au bénéficiaire exige une approbation DAO exécutée.'),
('M3 - Vote', 'Actions de déblocage anticipé, gel et validation du retrait final ; quorum 50 % ; majorité absolue de l’offre snapshot.'),
('M3 - Exécution', 'Délai en blocs et exécuteur automatique dédié à Hardhat local.'),
('M4 - Interface', 'React, Ethers.js, connexion MetaMask, liste, collecte et tableau de vote ; actualisation toutes les 4 s.'),
('ABI et IPFS', 'ABI exportées depuis la compilation ; hash seul on-chain et métadonnées sur IPFS.'),
('Tests et fuzzing', '39 tests ; scénario de 18 contributions pseudo-aléatoires à graine fixe.'),
('Sécurité obligatoire', 'AccessControl, CEI, ReentrancyGuard, pause et multisignature 2-sur-3.'),
('Audit statique', 'Slither 0.11.6 relancé sur les contrats finaux ; résultats bruts et triage conservés.'),
('Bonus', 'Export RPC de l’historique ContributionReceived, puis heuristiques Python.'),
('Livrables', 'Arborescence attendue, rapport de 10 pages, preuves locales et scénario de soutenance.')], [145,350])
p('La recette de signature MetaMask, les noms des membres de l’équipe et la soutenance sont des éléments à compléter ou à démontrer par l’équipe. Aucun nom ni résultat de soutenance n’est inventé. Les captures du rapport sont celles de l’instance locale corrigée.', 'SmallCustom')

heading(3, 'Architecture et choix techniques')
p('Hardhat est retenu pour compiler, déployer et tester les contrats dans le même environnement JavaScript/TypeScript que l’interface. Ses comptes locaux et ses outils de simulation du temps permettent de vérifier les échéances, les snapshots et les attaques sans dépendre d’un réseau public. Solidity 0.8.28 compile avec optimisation à 200 passages et cible EVM Cancun.')
table(['Composant', 'Responsabilité et échanges'], [
('Utilisateur / MetaMask', 'Signe les créations, contributions, propositions, votes et retraits.'),
('CrowdfundingCore', 'Détient les ETH ; mémorise les contributions ; appelle mint, burn et déblocage des CFD.'),
('CFDToken', 'Solde ERC-20, verrou de transfert par détenteur, checkpoints et auto-délégation à la réception.'),
('CampaignGovernance', 'Fige les poids historiques ; compte les votes ; appelle le Core après approbation.'),
('MultiSigTreasury', 'Détient une trésorerie distincte ; exige une ou deux confirmations selon l’opération.'),
('Exécuteur local', 'Observe les propositions exécutables et soumet execute() ; ne décide pas du résultat.'),
('IPFS / interface', 'Le CID on-chain permet de lire le titre et la description ; les données externes sont validées.')], [145,350])
p('Permissions au déploiement', 'SubCustom')
p('Le déployeur reçoit les rôles administratifs et de pause. Le Core reçoit MINTER_ROLE et BURNER_ROLE sur le jeton ; seul le contrat de gouvernance reçoit GOVERNANCE_ROLE sur le Core. La trésorerie possède exactement trois adresses distinctes. Le manifeste sauvegarde le réseau, les adresses, le bloc de déploiement et les paramètres.')
p('La trésorerie n’est pas le séquestre des campagnes. Une campagne peut la désigner comme bénéficiaire ; sinon le Core paie directement son bénéficiaire après vote. Cette distinction évite de prétendre que la règle multisignature s’applique à un contrat qui ne la met pas en œuvre.')
p('La valeur de 100 CFD par ETH fournit une unité de lecture simple. Le taux immuable conserve la proportionnalité et empêche une modification arbitraire après contribution. Le nombre absolu ne change pas la part relative des voix.')

heading(4, 'CFD : supprimer les voix gratuites')
p('Défaut initial', 'SubCustom')
p('Un contributeur pouvait transférer les CFD reçus, puis récupérer son ETH après l’échec de sa campagne. Le burn était plafonné au solde restant : le destinataire conservait les jetons. Le même capital pouvait ensuite financer une autre campagne et créer de nouvelles voix. Un snapshot ne corrige pas ce défaut si l’accumulation précède la proposition.')
p('Règle corrigée', 'SubCustom')
p('Chaque mint de contribution augmente lockedBalance du détenteur. Les fonctions transfer et transferFrom ne peuvent déplacer que le solde non verrouillé. Le vote reste possible : le verrou protège la restitution financière, il n’empêche pas la participation politique.')
p('Lors du remboursement, le Core détruit exactement montantWei × 100 unités CFD. Le verrou est diminué du même montant et le transfert ETH suit la mise à jour de l’état. Il n’existe plus de destruction partielle laissant en circulation des CFD issus de cette contribution remboursée.')
table(['Invariant', 'Conséquence'], [
('lockedBalance ≤ balanceOf', 'Les jetons nécessaires au remboursement restent détenus.'),
('transfer ≤ balanceOf - lockedBalance', 'Un tiers ne peut pas emporter les jetons encore remboursables.'),
('burn = contributionWei × tokensPerEth', 'La restitution du capital retire toutes les voix correspondantes.'),
('Déblocage seulement après PaidOut', 'Les CFD deviennent transférables lorsque la campagne ne peut plus rembourser.'),
('Déblocage une seule fois par campagne et contributeur', 'Une campagne payée ne peut pas déverrouiller les CFD d’une autre campagne.')], [245,250])
p('Après paiement, releaseContributionTokens(id, contributeur) libère les jetons de cette contribution. Tout appelant peut déclencher la libération, mais les jetons restent chez le contributeur. Un bouton permet de le faire dans l’interface. Cette opération individuelle évite une boucle coûteuse sur tous les donateurs au moment du paiement.')
p('Ce choix introduit une restriction de transfert explicite sur l’ERC-20 tant que la campagne est remboursable. Elle est nécessaire pour combiner remboursement garanti et conservation exacte des voix. Les restrictions doivent être expliquées aux utilisateurs.')

heading(5, 'Campagnes et autorisation de paiement')
table(['État', 'Opérations autorisées'], [
('En cours', 'Contribuer avant échéance ; soumettre un vote de déblocage anticipé ou de gel.'),
('Réussie, sans approbation', 'Objectif atteint : collecte immédiatement fermée ; retrait bloqué jusqu’à la validation DAO.'),
('Réussie, approuvée', 'Approbation DAO exécutée ; seul le bénéficiaire peut retirer. Les contributions sont closes.'),
('Échouée', 'Objectif non atteint ; remboursement individuel et burn intégral des CFD associés.'),
('Gelée / Annulée', 'Nouvelles contributions et paiement bloqués ; remboursement individuel possible hors pause.'),
('Payée', 'Aucun second paiement ; les contributeurs peuvent rendre leurs CFD transférables.')], [170,325])
p('Retrait normal', 'SubCustom')
p('La collecte se ferme dès que l’objectif est atteint, sans attendre l’échéance, et toute contribution dépassant le montant restant est refusée. La durée de campagne reste l’échéance maximale : si l’objectif n’est pas atteint à cette date, les contributeurs peuvent se rembourser. L’objectif atteint ne suffit pas à payer le bénéficiaire : un détenteur de voix crée une proposition de validation du retrait final (action 2). Le vote doit satisfaire quorum, majorité et délai. L’exécution appelle approveRelease. Le bénéficiaire peut ensuite appeler withdrawFunds. Le Core marque PaidOut avant l’envoi ETH et refuse toute répétition.')
p('Déblocage anticipé', 'SubCustom')
p('L’action 0 permet de payer avant l’échéance, même sous l’objectif, après décision collective. L’approbation ferme la collecte et rend le paiement disponible. Elle ne peut pas être appliquée après l’échéance à une campagne échouée. Cette vérification évite qu’un vote de déblocage tardif contourne les droits de remboursement.')
p('Une campagne approuvée anticipativement s’affiche comme réussie au sens de sa décision de financement, même si son objectif initial n’a pas été atteint. Le montant collecté et l’objectif restent visibles. Un gel ultérieur bloque le paiement tant que le Core n’a pas déjà payé.')
p('Pause d’urgence', 'SubCustom')
p('La pause du Core suspend création, contribution, retrait et remboursement. La pause du jeton bloque mint et transferts ; le burn autorisé de remboursement reste permis si le Core est actif. Les deux pauses ont ainsi des effets documentés et distincts.')

heading(6, 'Gouvernance et exécution locale')
p('Le poids est celui du bloc précédant la proposition, calculé par getPastVotes. Il vaut exactement le solde de CFD : le jeton auto-délègue chaque adresse à la réception et désactive delegate et delegateBySig, afin qu’aucune voix ne circule indépendamment des jetons, conformément au module M3. Le quorum exige 50 % de participation et l’adoption exige strictement plus de 50 % de toute l’offre CFD historique en votes « Pour ». Les abstentions ne deviennent pas des votes contre, mais elles empêchent une minorité active de décider seule. Avec cinq détenteurs de poids égal, trois votes favorables sont nécessaires. Ce choix satisfait l’exigence du cahier des charges de définir et justifier quorum et majorité.')
p('Le déploiement local laisse un vote ouvert 150 blocs, soit environ cinq minutes avec un bloc toutes les deux secondes. Cette fenêtre permet de changer de compte MetaMask et de faire voter plusieurs contributeurs. Après la fin du vote, un délai de 5 blocs supplémentaires précède l’exécution. La formule ajoute un bloc de séparation pour interdire une exécution au dernier bloc où le vote reste ouvert, même avec un délai configuré à zéro. La fenêtre se comptant en blocs et non en secondes, elle est réglée par réseau : Sepolia produisant un bloc toutes les douze secondes environ, le déploiement public emploie 25 blocs de vote et 2 blocs de délai pour retrouver les mêmes ordres de grandeur en temps réel. Le quorum et la majorité restent identiques sur les deux réseaux.')
p('Une blockchain n’exécute pas spontanément un contrat lorsque le temps passe. scripts/keeper.mjs observe l’état exécutable et envoie la transaction. Sur Hardhat local, il active un bloc toutes les deux secondes et contrôle les décisions toutes les trois secondes. Il refuse les réseaux publics et utilise seulement un compte local déjà déverrouillé. Le bouton Exécuter reste disponible en secours pour un wallet connecté.')
screenshot('gouvernance-corrigee.png', 'Capture réelle : proposition #1 exécutée sur le déploiement local corrigé ; 300 CFD pour, 0 contre.')
p('L’interface relit les données toutes les quatre secondes. L’automatisation locale dépend du processus keeper en fonctionnement. Aucun service d’exécution Sepolia n’est annoncé comme déployé.', 'SmallCustom')

heading(7, 'Analyse de sécurité')
table(['Menace', 'Défense', 'Risque restant'], [
('Réentrance', 'ReentrancyGuard et état mis à jour avant appel ETH ; test de contrat hostile.', 'Revue requise pour tout nouveau chemin externe.'),
('Retrait non autorisé', 'onlyRole pour approuver ; bénéficiaire vérifié ; approbation obligatoire.', 'L’administrateur peut réattribuer des rôles.'),
('Voix gratuites après remboursement', 'Verrou des CFD remboursables et burn exact.', 'Les voix historiques d’un vote déjà ouvert restent figées selon la règle snapshot.'),
('Double vote par transfert', 'Poids historique commun et hasVoted.', 'Un capital durablement détenu peut dominer un vote.'),
('Trésorerie compromise', 'Deux confirmations au-delà de 1 ETH et pour tout appel portant des données.', 'Plusieurs petits retraits restent possibles sous le seuil choisi.'),
('Incident actif', 'Pause du Core par rôle dédié.', 'Une pause peut retarder les remboursements ; procédure de reprise nécessaire.'),
('Perte de disponibilité IPFS', 'CID vérifié et passerelle configurable.', 'Un CID ne garantit pas un épinglage durable.'),
('Mauvais réseau du wallet', 'Comparaison de chainId avant signature et réseau configuré au déploiement.', 'Vérification manuelle des détails affichés par le wallet toujours utile.')], [115,205,175])
p('La trésorerie suit elle aussi Checks-Effects-Interactions : la transaction est marquée exécutée avant son appel externe. Les propriétaires sont distincts et non nuls ; la soumission vaut première confirmation. Une confirmation peut être révoquée avant exécution.')
p('Un appel avec données exige deux propriétaires même si sa valeur ETH est nulle, car il peut transférer des ERC-20 détenus par la trésorerie. Le test reproduit ce cas. Le seuil de 1 ETH est une limite pédagogique immuable, facile à démontrer avec les comptes Hardhat ; ce n’est pas une limite économique universelle.')
p('L’administration initiale reste une hypothèse de confiance. Avant un usage réel, transférer les privilèges vers une autorité collective et revoir les procédures de pause, d’exécution et de récupération. Ces mesures opérationnelles ne sont pas présentées comme déjà réalisées.')

heading(8, 'Tests et audit des contrats finaux')
p('Résultat exécuté : 39 tests réussis, sans échec. npm test inclut le fichier principal et les régressions complémentaires. Les simulations se déroulent sur un réseau isolé ; elles ne modifient pas les campagnes de la démonstration.')
table(['Famille', 'Preuves vérifiées'], [
('Collecte et jeton', 'ETH séquestré, 100 CFD par ETH, montants nuls rejetés, échéance respectée.'),
('Remboursement', 'Restitution et burn exact, transfert/transferFrom verrouillés, trois cycles sans accumulation.'),
('Paiement', 'Vote obligatoire même après succès, bénéficiaire exclusif, paiement unique.'),
('Déblocage CFD', 'Seulement après paiement, une seule fois, isolation entre campagnes.'),
('Gouvernance', 'Quorum, majorité, double vote, snapshot, campagne inexistante et délai nul.'),
('Sécurité', 'Administration refusée aux tiers, pause/reprise, attaque de réentrance bloquée.'),
('Trésorerie', 'Seuil exact, deux signatures, données sans ETH, révocation, doublons.'),
('Exécuteur', 'Décision exécutée automatiquement ; réseau public refusé.'),
('Fuzzing reproductible', '18 contributions pseudo-aléatoires ; sommes de contributions et soldes cohérents.')], [145,350])
p('Analyse statique', 'SubCustom')
p('Slither 0.11.6 a analysé 43 contrats, dépendances comprises, avec 102 détecteurs. Résultat brut : 8 alertes, aucune High. La comparaison du poids de vote à zéro produit 1 alerte Medium incorrect-equality : il s’agit ici d’un test d’éligibilité intentionnel. Quatre alertes Low timestamp concernent les échéances. Trois alertes Informational low-level-calls concernent les transferts ETH et l’appel générique multisig, avec résultat vérifié et protection de réentrance.')
p('Les findings sont triés dans audit/slither-report.md et conservés dans audit/slither-final-2026-11-04.json. Une sortie Slither avec findings renvoie le code 1 ; le JSON confirme que l’analyse a réussi. L’absence d’alerte High ne prouve pas l’absence de faille métier.')
p('Limites de validation : le fuzzing n’est pas exhaustif, le parcours de signature dans l’extension MetaMask reste à exécuter, et aucun audit indépendant n’a été réalisé. La compilation TypeScript et le build Vite ont réussi ; un avertissement de taille du bundle reste une optimisation de performance.')

heading(9, 'Déploiement corrigé et preuve locale')
manifest = json.loads((ROOT/'deployments/localhost.json').read_text(encoding='utf-8'))
p(f'Réseau : Hardhat local ; chainId {manifest["chainId"]}. Le manifeste indique un premier déploiement du Core au bloc {manifest["deploymentBlock"]}. Le script génère automatiquement frontend/.env avec les adresses et le réseau cible. Les ABI utilisées par la dApp proviennent des artefacts compilés, via scripts/export-abis.mjs.')
table(['Contrat', 'Adresse locale'], list(manifest['contracts'].items()), [145,350])
screenshot('campagne-cid.png', 'Capture réelle : métadonnées du CID fourni, campagne solaire et financement de démonstration de 3 ETH. Le réseau local utilise exclusivement des fonds de test.', width=495)
p('CID : bafkreih33xpwo4wnh7u6c74zvcltj3h3giygigxlmkheqmc4mtmprxmtwy', 'SmallCustom')
p('Démarrage reproductible : npm install ; npm run check ; npm run node ; dans un second terminal, npm run deploy:local puis npm run demo:local ; lancer aussi npm run keeper:local et npm run frontend:dev. Après redémarrage complet du nœud, redéployer les contrats.', 'SmallCustom')
p('Sepolia est configurable par variables de processus : SEPOLIA_RPC_URL, TREASURY_OWNERS, FRONTEND_RPC_URL et les durées de vote. La clé de déploiement est lue dans un keystore chiffré par mot de passe (plugin hardhat-keystore), ou à défaut dans SEPOLIA_PRIVATE_KEY : le keystore évite de faire transiter la clé par l’environnement et l’historique du shell. FRONTEND_RPC_URL désigne un RPC public afin qu’aucune clé d’API ne soit incluse dans le bundle livré au navigateur. Le script vérifie la chaîne et trois propriétaires distincts. Le RPC et le chainId du front suivent le déploiement. Le déploiement Sepolia a été effectué depuis 0x568e84bB2690Dd0c4cd9b33465412C70D63901E7 : CFDToken 0x95FDb2b1f16cCF4648FE29647bB1eC4BCd025003, CrowdfundingCore 0x3371A6C82173d21d8D214cBe5045227Ec048fC15, CampaignGovernance 0x64964d2bc8419F19D20421CBcFB473494b1b03ed, MultiSigTreasury 0x4652D5c4adaEcC7bc13d021cdD45e7c604Ed7D56. La fenêtre de vote y vaut 25 blocs et le délai d’exécution 2 blocs, soit environ cinq minutes et une demi-minute au rythme de Sepolia. Les trente contrôles on-chain de npm run verify:sepolia passent sur ces adresses.', 'SmallCustom')

heading(10, 'Recette, bonus et limites restantes')
p('Recette de démonstration en dix minutes', 'SubCustom')
table(['Temps', 'Démonstration'], [('0-2 min', 'Présenter les quatre contrats, les rôles et le séquestre des fonds.'), ('2-4 min', 'Créer une campagne avec le CID fourni, contribuer et montrer les CFD et le pouvoir de vote immédiat.'), ('4-6 min', 'Créer un vote, montrer le snapshot, voter et observer l’exécution après délai.'), ('6-8 min', 'Montrer le paiement autorisé, le refus sans vote et le remboursement avec burn exact dans les tests.'), ('8-10 min', 'Démontrer la réentrance bloquée, la pause et le seuil multisig ; commenter Slither.')], [85,410])
p('Le parcours réel MetaMask doit confirmer : connexion et changement de réseau, deux comptes de contribution, refus de signature sans effacement du formulaire, vote, retrait par le bénéficiaire et remboursement. L’interface ne remplace pas les contrôles on-chain. Aucun écran administratif ou de trésorerie n’est ajouté : ces opérations restent démontrables par scripts et tests, conformément au périmètre minimal de M4.')
p('Bonus hors chaîne', 'SubCustom')
p('npm run analyze:local exporte les événements ContributionReceived depuis le bloc de déploiement, récupère leurs horodatages et lance le script Python. La chaîne est vérifiée par rapport au manifeste. Les heuristiques signalent au moins quatre montants identiques, une adresse représentant au moins 60 % du volume et une heure au moins quatre fois supérieure à la médiane. Un export réel de la campagne locale a été analysé. La concentration d’une adresse unique est un signal attendu, pas une preuve de fraude.')
p('Limites et suite', 'SubCustom')
p('Le keeper fourni automatise seulement Hardhat local. Un réseau public exige son propre service opérateur. Les contrats ne sont pas évolutifs et une correction exige un nouveau déploiement. Les snapshots n’empêchent pas la domination par un gros détenteur. Le pinning IPFS doit être maintenu. Le dépôt doit être relu et enregistré dans Git avant livraison. Le rapport antérieur de 39 pages est remplacé comme référence technique par ce document de 10 pages, sans inventer d’identité d’équipe. Le déploiement Sepolia est réel et vérifiable aux adresses indiquées ; la démonstration en direct reste conduite sur Hardhat local, où le keeper exécute les décisions automatiquement.')
p('Sources de référence', 'SubCustom')
p('Cahier des charges mini_projet_blockchain.pdf, pages 1-2 ; code source des quatre contrats ; tests CrowdfundDAO.ts et verification.test.ts ; sortie Slither finale ; manifeste localhost.json ; captures réelles sous docs/screenshots. Les références externes de bibliothèque sont les paquets installés OpenZeppelin, Hardhat et Ethers.js. Les résultats présentés correspondent à la version locale du 4 novembre 2026.', 'SmallCustom')

def footer(c, doc):
    c.saveState(); c.setStrokeColor(HexColor('#cdddD4')); c.line(46,42,549,42)
    c.setFont('Arial',8); c.setFillColor(INK)
    c.drawString(46,28,'Crowdfund DAO - Version corrigée - 04/11/2026')
    c.drawRightString(549,28,f'{doc.page} / 10'); c.restoreState()

doc = SimpleDocTemplate(str(OUT), pagesize=(595.28,841.89), rightMargin=50,leftMargin=50,topMargin=42,bottomMargin=57,title='Crowdfund DAO - Rapport technique corrigé',author='Équipe projet')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(str(OUT))
# Le cahier des charges impose un rapport de 10 à 15 pages : on contrôle cet
# intervalle plutôt qu'un nombre fixe, qui bloquait à chaque ajout de contenu.
assert 10 <= len(reader.pages) <= 15, f'Le rapport doit faire 10 a 15 pages, il en fait {len(reader.pages)}'
print(f'{OUT}: {len(reader.pages)} pages')
