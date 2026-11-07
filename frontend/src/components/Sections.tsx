/**
 * Sections éditoriales reprises de la page d'accueil GoFundMe : les trois
 * étapes « conviviale, efficace et sécurisée », le bloc d'aide avec ses
 * questions fréquentes, et le bandeau de réassurance « leader de confiance ».
 * Le discours est transposé au fonctionnement réel du contrat.
 */

const STEPS = [
  {
    title: "Utilisez nos outils pour créer votre campagne",
    body: (
      <>
        Un formulaire vous guide pour fixer l'objectif, l'échéance et le
        bénéficiaire. Les détails lisibles du projet vivent sur IPFS ; seule leur
        empreinte est inscrite on-chain.
      </>
    ),
    link: { label: "Bénéficiez de conseils pour lancer une campagne", href: "#launch" },
  },
  {
    title: "Mobilisez les donateurs en partageant votre campagne",
    body: (
      <>
        Chaque campagne est publique et vérifiable par son identifiant. Partagez
        le lien : les contributions arrivent directement dans le contrat de
        séquestre, sans intermédiaire.
      </>
    ),
    link: { label: "Voir les campagnes en cours", href: "#campaigns" },
  },
  {
    title: "Recevez des fonds en toute sécurité",
    body: (
      <>
        Les fonds restent bloqués jusqu'à ce que l'objectif soit atteint et que
        la DAO valide le retrait. Si la campagne échoue, chaque donateur peut
        réclamer son remboursement.
      </>
    ),
    link: { label: "Comprendre le vote de la DAO", href: "#governance" },
  },
];

export function HowItWorks() {
  return (
    <section className="steps" id="how">
      <div className="steps-inner">
        <p className="eyebrow"><span>◆</span> Comment ça marche</p>
        <h2>La collecte de fonds sur Crowdfund DAO est conviviale, efficace et sécurisée</h2>
        <div className="steps-grid">
          {STEPS.map((step, index) => (
            <article className="step" key={step.title}>
              <span className="step-number" aria-hidden="true">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <p><a href={step.link.href}>{step.link.label}</a>.</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  {
    question: "Que devient mon don si l'objectif n'est pas atteint ?",
    answer:
      "La campagne passe en « Échouée » à l'échéance et le contrat ouvre le remboursement. Le bouton « Réclamer mon remboursement » apparaît alors sur sa carte : vous récupérez l'intégralité de votre contribution, moins le seul gas de la transaction.",
  },
  {
    question: "Quels sont les frais de la plateforme ?",
    answer:
      "Aucun. Le contrat ne prélève pas de commission : 100 % des montants collectés vont au bénéficiaire. Seuls les frais de réseau Ethereum (gas) s'appliquent, et ils sont payés par celui qui signe la transaction.",
  },
  {
    question: "À quoi servent les jetons CFD que je reçois ?",
    answer:
      "Chaque contribution émet des jetons CFD proportionnels au montant donné. Ils constituent votre droit de vote sur les décisions de la DAO : déblocage anticipé, gel d'une campagne suspecte, validation du retrait final. Le poids de votre vote est votre solde de CFD, sans démarche préalable.",
  },
  {
    question: "Pourquoi mes CFD ne sont-ils pas transférables ?",
    answer:
      "Tant qu'une campagne peut encore donner lieu à un remboursement, les jetons restent verrouillés : sinon il serait possible de voter puis de revendre son pouvoir avant l'exécution. Une fois la campagne payée, le bouton « Rendre mes CFD transférables » les libère.",
  },
  {
    question: "Qui peut retirer l'argent d'une campagne ?",
    answer:
      "Seule l'adresse bénéficiaire déclarée à la création, et seulement après qu'une proposition de retrait a été approuvée par le vote. Le créateur d'une campagne ne peut pas se servir en contournant la DAO.",
  },
  {
    question: "Comment vérifier qu'une campagne est authentique ?",
    answer:
      "Chaque carte expose l'adresse du bénéficiaire et un lien « Vérifier les métadonnées sur IPFS ». Le document pointé est immuable : s'il ne correspond pas à ce que la campagne annonce, la DAO peut geler la collecte.",
  },
];

export function Help() {
  return (
    <section className="help" id="faq">
      <div className="help-inner">
        <div>
          <p className="eyebrow"><span>◆</span> Nous nous occupons de tout pour vous</p>
          <h2>Disposez de tout ce dont vous avez besoin pour réussir votre campagne</h2>
          <p>
            Qu'il s'agisse d'un projet associatif, d'une urgence ou d'un
            financement d'équipe, les règles sont écrites dans le contrat et les
            mêmes pour tout le monde. Vous pouvez poser vos questions ici, à tout
            moment, si vous avez besoin d'aide.
          </p>
          <p>
            Vous avez d'autres questions ?{" "}
            <a href="#how">En savoir plus sur le fonctionnement de Crowdfund DAO</a>.
          </p>
        </div>
        <div className="faq">
          {FAQ.map((entry) => (
            <details key={entry.question}>
              <summary>{entry.question}</summary>
              <p>{entry.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const TRUST_CARDS = [
  {
    title: "Des règles simples",
    body: "Pas de commission, pas de conditions cachées : le barème est le code du contrat, public et identique pour chaque campagne.",
  },
  {
    title: "Fiabilité et protection",
    body: "Les fonds sont séquestrés par le contrat, pas détenus par une société. Le remboursement est automatique dès qu'une campagne échoue, est gelée ou annulée.",
  },
  {
    title: "Une communauté aux commandes",
    body: "Les donateurs votent le déblocage des fonds au prorata de leur contribution. Chaque décision laisse une trace immuable sur la blockchain.",
  },
];

export function Trust() {
  return (
    <section className="trust" id="trust">
      <p className="eyebrow"><span>◆</span> Nous nous occupons de tout pour vous</p>
      <h2>Crowdfund DAO est un financement participatif dont vous gardez le contrôle.</h2>
      <p>
        Avec des règles simples et des garde-fous inscrits dans le contrat, vous
        pouvez collecter des fonds ou faire un don en toute sérénité.
      </p>
      <div className="trust-grid">
        {TRUST_CARDS.map((card) => (
          <article className="trust-card" key={card.title}>
            <b>{card.title}</b>
            <p>{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
