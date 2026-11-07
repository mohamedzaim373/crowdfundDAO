/**
 * Publication des métadonnées de campagne sur IPFS via Pinata.
 *
 * ATTENTION — le jeton est lu depuis `import.meta.env`, donc il est inclus en
 * clair dans le bundle JavaScript servi au navigateur. N'importe quel visiteur
 * peut l'extraire et s'en servir pour épingler sur votre compte. C'est
 * acceptable pour une démo locale, pas pour une mise en production : il
 * faudrait alors un service intermédiaire qui garde le jeton côté serveur.
 *
 * Limitez au minimum la clé générée sur Pinata : seules les permissions
 * `pinFileToIPFS` et `pinJSONToIPFS` sont nécessaires.
 */

const PINATA_JWT = (import.meta.env.VITE_PINATA_JWT ?? "").trim();

export const isPinataConfigured = PINATA_JWT !== "";

const PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

// Au-delà, l'envoi devient très long sur une connexion ordinaire et la
// vignette n'y gagne rien : une couverture de carte fait 430×210.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type CampaignMetadataInput = {
  name: string;
  description: string;
  category: string;
  image?: string;
};

/** Message lisible à partir de la réponse d'erreur de l'API Pinata. */
async function describeFailure(response: Response) {
  // Pinata répond `{ error: { reason, details } }`, mais renvoie du texte brut
  // sur certaines erreurs d'authentification.
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: { reason?: string; details?: string } | string };
    const error = parsed.error;
    const reason = typeof error === "string" ? error : error?.details ?? error?.reason;
    if (reason) return reason;
  } catch {
    if (body.trim()) return body.trim().slice(0, 200);
  }

  if (response.status === 401 || response.status === 403) {
    return "jeton Pinata refusé — vérifiez VITE_PINATA_JWT et les permissions de la clé";
  }
  return `réponse ${response.status} de Pinata`;
}

async function pinataPost(url: string, body: BodyInit, headers: HeadersInit = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}`, ...headers },
    body,
    // Un upload bloqué ne doit pas laisser le formulaire figé indéfiniment.
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) throw new Error(await describeFailure(response));

  const payload = (await response.json()) as { IpfsHash?: string };
  if (!payload.IpfsHash) throw new Error("Pinata n’a pas renvoyé de CID.");
  return payload.IpfsHash;
}

/** Épingle une image et renvoie son CID. */
export async function uploadImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`« ${file.name} » n’est pas une image.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `L’image fait ${(file.size / 1024 / 1024).toFixed(1)} Mo, au-delà de la limite de ${MAX_IMAGE_BYTES / 1024 / 1024} Mo.`,
    );
  }

  const form = new FormData();
  form.append("file", file);
  form.append("pinataMetadata", JSON.stringify({ name: file.name }));
  // CIDv1 pour rester cohérent avec les CID déjà utilisés par le projet.
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  // Pas de Content-Type explicite : le navigateur doit poser lui-même la
  // frontière multipart, qu'on ne peut pas deviner ici.
  return pinataPost(PIN_FILE_URL, form);
}

/**
 * Épingle le motif d'une proposition et renvoie son CID. Le contrat ne garde
 * que cette empreinte : le texte lisible doit donc être publié avant le vote.
 */
export async function uploadProposalMotive(campaignId: number, action: string, text: string) {
  return pinataPost(
    PIN_JSON_URL,
    JSON.stringify({
      pinataContent: {
        type: "crowdfund-dao-proposal",
        campaignId,
        action,
        description: text,
        createdAt: new Date().toISOString(),
      },
      pinataMetadata: { name: `proposition-campagne-${campaignId}` },
      pinataOptions: { cidVersion: 1 },
    }),
    { "Content-Type": "application/json" },
  );
}

/** Épingle le document de métadonnées et renvoie son CID. */
export async function uploadMetadata(input: CampaignMetadataInput) {
  const document = {
    name: input.name,
    description: input.description,
    ...(input.image ? { image: `ipfs://${input.image}` } : {}),
    category: input.category,
    createdAt: new Date().toISOString().slice(0, 10),
  };

  return pinataPost(
    PIN_JSON_URL,
    JSON.stringify({
      pinataContent: document,
      pinataMetadata: { name: `campagne-${input.name}`.slice(0, 80) },
      pinataOptions: { cidVersion: 1 },
    }),
    { "Content-Type": "application/json" },
  );
}
