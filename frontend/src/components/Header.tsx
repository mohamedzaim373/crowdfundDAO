import { FormEvent, useEffect, useRef, useState } from "react";

/**
 * En-tête repris de la page d'accueil GoFundMe sauvegardée à la racine du
 * projet (`hrt-header--fixed` + `homepage-header-fixed--transparent`) :
 * `position: sticky` pour rester visible au défilement sans sortir du flux,
 * transparent au-dessus du héros puis blanc ombré dès que la page bouge.
 */

type MenuItem = { label: string; description: string; href: string };
type Menu = { id: string; label: string; items: MenuItem[] };

// Arborescence calquée sur les volets « Je soutiens » / « Collecter des fonds »
// / « À propos de » du site, traduite en parcours on-chain.
const MENUS: Menu[] = [
  {
    id: "support",
    label: "Je soutiens",
    items: [
      { label: "Campagnes ouvertes", description: "Les projets qui attendent un financement", href: "#campaigns" },
      { label: "Décisions de la DAO", description: "Votez sur l'usage des fonds collectés", href: "#governance" },
      { label: "Garantie de remboursement", description: "Comment le contrat protège votre don", href: "#faq" },
      { label: "Mes CFD", description: "Solde, jetons verrouillés et pouvoir de vote", href: "#my-cfd" },
    ],
  },
  {
    id: "fundraise",
    label: "Collecter des fonds",
    items: [
      { label: "Lancer une campagne", description: "Publier un objectif et une échéance", href: "#launch" },
      { label: "Comment démarrer", description: "Les trois étapes, de l'idée au retrait", href: "#how" },
      { label: "Préparer ses métadonnées", description: "Titre, description et visuel sur IPFS", href: "#faq" },
    ],
  },
  {
    id: "about",
    label: "À propos de",
    items: [
      { label: "Comment ça marche", description: "Séquestre, jetons CFD et vote", href: "#how" },
      { label: "Frais de la plateforme", description: "Aucun : seul le gas du réseau s'applique", href: "#trust" },
      { label: "Trésorerie multisig", description: "Solde, propriétaires et retraits 2 sur 3", href: "#treasury" },
      { label: "Sécurité des fonds", description: "Les garde-fous inscrits dans le contrat", href: "#trust" },
    ],
  },
];

type Props = {
  account: string;
  busy: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onConnect: () => void;
  shortAddress: (address: string) => string;
  /** Lien « Administration » : uniquement pour un compte admin ou pauser. */
  showAdmin: boolean;
};

export default function Header({ account, busy, query, onQueryChange, onConnect, shortAddress, showAdmin }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLUListElement>(null);

  // Le seuil n'est pas zéro : un rebond de défilement ne doit pas faire
  // clignoter le fond de l'en-tête.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Un menu ouvert doit se refermer au clic ailleurs et à Échap, sinon il reste
  // suspendu au-dessus du contenu après la navigation vers l'ancre.
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    // La recherche filtre une grille déjà en mémoire : rien à envoyer, mais on
    // amène le visiteur sur les résultats.
    event.preventDefault();
    setMobileOpen(false);
    document.getElementById("campaigns")?.scrollIntoView({ behavior: "smooth" });
  }

  const searchField = (
    <form className="header-search" role="search" onSubmit={submitSearch}>
      <span className="search-icon" aria-hidden="true">⌕</span>
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Rechercher une campagne"
        aria-label="Rechercher une campagne"
      />
      {query && (
        <button type="button" className="search-clear" onClick={() => onQueryChange("")} aria-label="Effacer la recherche">
          ×
        </button>
      )}
    </form>
  );

  const walletButton = (
    <button className="wallet" onClick={onConnect} disabled={busy}>
      <span className="pulse" />
      {account ? shortAddress(account) : "Connecter MetaMask"}
    </button>
  );

  return (
    <>
      <a className="skip-link" href="#top">Passer au contenu</a>
      <header
        className={`site-header${scrolled ? " site-header--scrolled" : ""}${mobileOpen ? " site-header--open" : ""}`}
      >
        <div className="header-inner">
          <a className="brand" href="#top" aria-label="Crowdfund DAO">
            <span className="brand-mark">C</span>
            <span>Crowdfund<span>DAO</span></span>
          </a>

          {searchField}

          <ul className="nav-menu" ref={navRef}>
            {MENUS.map((menu) => (
              <li
                className="nav-item"
                key={menu.id}
                onMouseEnter={() => setOpenMenu(menu.id)}
                onMouseLeave={() => setOpenMenu((current) => (current === menu.id ? null : current))}
              >
                <button
                  className="nav-trigger"
                  aria-expanded={openMenu === menu.id}
                  onClick={() => setOpenMenu((current) => (current === menu.id ? null : menu.id))}
                >
                  {menu.label}
                  <span className="nav-caret" aria-hidden="true" />
                </button>
                {openMenu === menu.id && (
                  <ul className="dd-content">
                    {menu.items.map((item) => (
                      <li key={item.label}>
                        <a className="dd-item" href={item.href} onClick={() => setOpenMenu(null)}>
                          <b>{item.label}</b>
                          <span>{item.description}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <div className="header-right">
            {showAdmin && <a className="header-admin" href="#admin">Administration</a>}
            <a className="header-link" href="#launch">Créer une campagne</a>
            {walletButton}
            <button
              className="burger"
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              onClick={() => setMobileOpen((open) => !open)}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="mobile-panel">
            {searchField}
            {MENUS.map((menu) => (
              <details className="mobile-group" key={menu.id}>
                <summary>{menu.label}</summary>
                {menu.items.map((item) => (
                  <a key={item.label} href={item.href} onClick={() => setMobileOpen(false)}>
                    {item.label}
                  </a>
                ))}
              </details>
            ))}
            {showAdmin && (
              <a className="mobile-admin" href="#admin" onClick={() => setMobileOpen(false)}>
                Administration
              </a>
            )}
            <details className="mobile-group">
              <summary>Créer une campagne</summary>
              <a href="#launch" onClick={() => setMobileOpen(false)}>Publier mon projet</a>
            </details>
            {walletButton}
          </div>
        )}
      </header>
    </>
  );
}
