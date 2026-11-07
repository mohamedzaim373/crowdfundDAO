#!/usr/bin/env node
// Calcule le CID IPFS (v1, codec raw) d'un fichier sans aucune dépendance.
// Identique à `ipfs add --cid-version=1 --raw-leaves` pour un fichier < 256 Ko.
//
//   node scripts/make-cid.mjs campagne.json

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/make-cid.mjs <fichier>");
  process.exit(1);
}

const content = readFileSync(file);
const digest = createHash("sha256").update(content).digest();

// <version 1> <codec raw = 0x55> <sha2-256 = 0x12> <longueur 32> <digest>
const cidBytes = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
const cid = `b${base32(cidBytes)}`; // le préfixe "b" annonce du base32

console.log(`fichier  : ${file} (${content.length} octets)`);
console.log(`sha256   : ${digest.toString("hex")}`);
console.log(`CID      : ${cid}`);
console.log(`à saisir : ipfs://${cid}`);
console.log(`passerelle : https://ipfs.io/ipfs/${cid}`);
