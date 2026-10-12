# AGENTS.md — Citrouille qui parle

Guide pour les agents (Claude Code, etc.) et pour reprendre le projet sur une autre machine (PC Windows de dev, Raspberry Pi).
Le cahier des charges complet est dans `CAHIER_DES_CHARGES.md` (objectif, fonctionnalités F1 à F12, architecture, risques).
Langue du projet : français (code commenté en français, accents obligatoires).

## Résumé

Pour Halloween (31 octobre), une citrouille « vivante » devant la maison : un opérateur la contrôle depuis son téléphone, voit/entend les passants, leur parle, et son visage est reproduit sur une matrice de LED dans la citrouille.

## État d'avancement (mis à jour le 2026-10-12)

### Fait (testé sur PC, dans le navigateur)
- Serveur Node (`server.js`) : fichiers statiques, HTTPS automatique si `certs/` existe, relais WebSocket `/ws` (rôles `control` et `render`), boucle d'animation à 40 images/s.
- Visage 16x16 (`shared/face.js`) : état d'expression -> image, animateur « cartoon » (ressorts, clignements, veille). Module partagé navigateur + Node. Le futur pilote de la vraie matrice réutilisera `render()` tel quel.
- Page de rendu (`public/render.html` + `matrix.js`) : matrice simulée, mode « LED » ou « citrouille » (diffusion à travers la chair).
- Backoffice (`public/backoffice.html`) : curseurs, micro (bouche pilotée par le volume), suivi du visage MediaPipe Face Landmarker (chargé depuis un CDN, donc Internet requis côté téléphone), mode veille / live.
- `npm run cert` : certificat HTTPS auto-signé (`scripts/gen-cert.js`).

### Pas encore fait
- **Pilote de la vraie matrice LED** sur le Pi (aucune matrice choisie : le code suppose du 16x16, donc plutôt WS2812 ; HUB75 reste une option, voir cahier §9).
- **Audio/vidéo via WebRTC** : F1 (vidéo caméra -> téléphone), F2 (micro -> téléphone), F3 (voix opérateur -> enceintes du Pi). Rien n'existe encore côté serveur.
- Code d'accès à la page (sécurité, cahier §6), service systemd, F8 (animations d'attente poussées), F9 à F12.

## Matériel (état réel)

- **Raspberry Pi 3B+** (1 Go de RAM, CPU 64 bits : OS 64 bits OK). Pas de Pi 4 contrairement au cahier.
- **OS prévu : Raspberry Pi OS Lite 64 bits**, sans interface graphique, Wi-Fi + SSH configurés via Raspberry Pi Imager.
- **Webcam USB Logitech (vieille)** : on utilise sa caméra ET son micro dans un premier temps. Normalement reconnue sans pilote (UVC + USB Audio). À vérifier avec `lsusb`, `v4l2-ctl --list-devices`, `v4l2-ctl -d /dev/video0 --list-formats-ext`, `arecord -l`.
- **Micro USB** de bonne qualité disponible (secours ou meilleur micro).
- **Mini caméra analogique** 5~20 V à 3 fils (VID, GND, 5~20V), sortie composite, sans micro : inutilisable directement. Il faudrait un dongle USB de capture composite (puce MS2109 de préférence). Mise de côté, la webcam USB est plus simple.
- **Enceintes** : il faudra une carte son USB (ou micro-casque USB). La sortie jack du Pi est de toute façon en conflit avec la bibliothèque HUB75 `rpi-rgb-led-matrix`.
- Alimentation 5 V, boîtier étanche/ventilé, matrice : à acheter/choisir.

## Prochaines étapes (ordre conseillé)

1. Sur le Pi : cloner le dépôt, installer Node.js (LTS), `npm install`, `npm run cert`, `npm start`, ouvrir `render.html` et `backoffice.html` depuis un autre appareil du réseau pour valider la base.
2. Vérifier la détection de la webcam (commandes ci-dessus) et tester une capture vidéo + audio.
3. Ajouter le streaming WebRTC (F1 à F3). Attention : le Pi 3B+ est limité (1 Go) ; envisager ffmpeg/GStreamer (encodeur H.264 matériel du Pi) plutôt qu'une pile WebRTC 100 % Node.
4. Choisir et brancher la matrice, écrire le pilote qui consomme `Face.render()`.
5. Service systemd, code d'accès, montage dans la citrouille, test en extérieur.

## Structure du dépôt

```
server.js            serveur HTTP(S) + WebSocket (port 8080 par défaut, variable PORT)
shared/face.js       logique du visage (navigateur + Node)
public/index.html    page d'accueil (liens)
public/render.html   écran de rendu (matrice simulée) ; matrix.js, net.js
public/backoffice.html  interface opérateur (téléphone)
scripts/gen-cert.js  génère certs/key.pem et certs/cert.pem (ignorés par git)
CAHIER_DES_CHARGES.md  spécifications
```

## Commandes

- `npm install` puis `npm start` : lance le serveur.
- `npm run cert` : (re)génère le certificat HTTPS ; à refaire sur chaque machine (le dossier `certs/` n'est pas versionné).
- Le navigateur du téléphone exige HTTPS pour la caméra et le micro. Il faut accepter l'avertissement du certificat auto-signé.

## Conventions

- Pas de dépendances inutiles : seule `ws` est installée. Code JS sans étape de build.
- Le code de `shared/` doit rester utilisable à la fois dans le navigateur et sous Node.
- Ne pas versionner `certs/` ni `node_modules/`.
