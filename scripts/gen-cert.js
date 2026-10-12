// Génère un certificat HTTPS auto-signé valable pour les adresses IP locales de cette machine.
// Usage : npm run cert   (à relancer si l'adresse IP change, ou sur le Pi une fois installé)
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.join(__dirname, '..', 'certs');
fs.mkdirSync(dir, { recursive: true });

const ips = Object.values(os.networkInterfaces()).flat()
  .filter((n) => n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
  .map((n) => n.address);

const san = ['DNS:localhost', 'IP:127.0.0.1', `DNS:${os.hostname()}`, ...ips.map((ip) => `IP:${ip}`)].join(',');
const args = [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
  '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
  '-subj', '/CN=citrouille', '-addext', `subjectAltName=${san}`
];

const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe'];
let done = false;
for (const bin of candidates) {
  try { execFileSync(bin, args, { stdio: 'pipe' }); done = true; break; } catch (e) { /* essai suivant */ }
}
if (!done) { console.error('openssl introuvable : installe Git for Windows ou OpenSSL.'); process.exit(1); }

console.log('Certificat créé dans certs/ pour : ' + san);
console.log('Relance ensuite : npm start');
