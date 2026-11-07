/**
 * Pied de page calqué sur le « Menu secondaire » de GoFundMe : quatre colonnes
 * de liens, puis la ligne de mentions légales et le sélecteur de langue.
 */

const COLUMNS = [
  {
    title: "Je soutiens",
    links: [
      { label: "Campagnes ouvertes", href: "#campaigns" },
      { label: "Campagnes en vedette", href: "#top" },
      { label: "Décisions de la DAO", href: "#governance" },
    ],
  },
  {
    title: "Collecter des fonds",
    links: [
      { label: "Lancer une campagne", href: "#launch" },
      { label: "Comment démarrer", href: "#how" },
      { label: "Préparer ses métadonnées", href: "#faq" },
    ],
  },
  {
    title: "À propos de",
    links: [
      { label: "Comment ça marche", href: "#how" },
      { label: "Garantie de remboursement", href: "#faq" },
      { label: "Frais de la plateforme", href: "#trust" },
      { label: "Sécurité des fonds", href: "#trust" },
    ],
  },
  {
    title: "Plus de ressources",
    links: [
      { label: "Questions fréquentes", href: "#faq" },
      { label: "Jeton de vote CFD", href: "#governance" },
      { label: "Qu'est-ce que le financement participatif ?", href: "#how" },
      { label: "Statistiques du protocole", href: "#metrics" },
    ],
  },
];

export default function Footer({ chainName }: { chainName: string }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-cols">
          <h2>Menu secondaire</h2>
          <div className="footer-brand">
            <div className="brand">
              <span className="brand-mark">C</span>
              <span>Crowdfund<span>DAO</span></span>
            </div>
            <p>
              Construit sur Ethereum · Gouverné par sa communauté · Sécurisé par
              conception.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3>{column.title}</h3>
              {column.links.map((link) => (
                <a key={link.label} href={link.href}>{link.label}</a>
              ))}
            </nav>
          ))}
        </div>

        <div className="footer-legal">
          <span className="footer-locale">◍ {chainName} · Français</span>
          <p>© 2026 Crowdfund DAO</p>
          <div className="footer-legal-links">
            <a href="#faq">Conditions</a>
            <a href="#faq">Avis de confidentialité</a>
            <a href="#trust">Fins juridiques</a>
            <a href="#trust">Garantie des dons</a>
          </div>
        </div>
      </div>
      <p className="footer-disclaimer">
        Les montants affichés sont lus directement sur la blockchain : ils
        reflètent l'état du contrat au dernier bloc interrogé. Aucun
        intermédiaire ne détient les fonds ; un don est irréversible tant que la
        campagne n'ouvre pas de droit au remboursement.
      </p>
    </footer>
  );
}
