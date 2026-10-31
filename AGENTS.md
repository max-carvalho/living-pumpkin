# AGENTS.md — Citrouille qui parle

Guide pour les agents (Claude Code, etc.) et pour reprendre le projet sur une autre machine (PC Windows de dev, Raspberry Pi).
Le cahier des charges complet est dans `CAHIER_DES_CHARGES.md` (objectif, fonctionnalités F1 à F12, architecture, risques).
Langue du projet : français (code commenté en français, accents obligatoires).

## Résumé

Pour Halloween (31 octobre), une citrouille « vivante » devant la maison : un opérateur la contrôle depuis son téléphone, voit/entend les passants, leur parle, et son visage est reproduit sur une matrice de LED dans la citrouille.

## État d'avancement (mis à jour le 2026-10-12)

### Fait (testé sur PC, dans le navigateur)
- Serveur Node (`server.js`) : fichiers statiques, HTTPS automatique si `certs/` existe (le même port redirige `http://` vers `https://`), relais WebSocket `/ws` (rôles `control` et `render`), boucle d'animation à 40 images/s.
- Visage 16x16 (`shared/face.js`) : état d'expression -> image, animateur « cartoon » (ressorts, clignements, veille). Module partagé navigateur + Node. Le futur pilote de la vraie matrice réutilisera `render()` tel quel.
- Page de rendu (`public/render.html` + `matrix.js`) : matrice simulée, mode « LED » ou « citrouille » (diffusion à travers la chair).
- Backoffice (`public/backoffice.html`) : curseurs, micro (bouche pilotée par le volume), suivi du visage MediaPipe Face Landmarker (chargé depuis un CDN, donc Internet requis côté téléphone), mode veille / live.
- `npm run cert` : certificat HTTPS auto-signé (`scripts/gen-cert.js`).

### Fait (sur le Pi, 2026-10-12)
- Projet installé et serveur validé depuis le téléphone. git et Node.js 24 LTS sont installés **sans sudo** dans `~/.local` (`~/.local/bin` dans le PATH).
- Caméra **IR sur la nappe CSI** du Pi (OV5647, remplace la webcam USB retirée) dans le backoffice (vidéo seule) : `camera.js` lance `rpicam-vid` (libcamera, MJPEG direct, noir et blanc, 640x480 à 20 images/s) et sert `/cam.mjpg`. Capture lancée seulement s'il y a un spectateur. Variables : `CAM_WIDTH`, `CAM_HEIGHT`, `CAM_FPS`, `CAM_ARGS` (options rpicam-vid en plus, ex. `--hflip --vflip` si l'image est à l'envers).
- **Tout en blanc pur, pleine puissance** (`COLORS` dans `face.js`) : la chair de la citrouille rend tout orange. Plus aucune couleur par élément. Le plafond `maxMilliamps` (2000 mA) assombrit l'image si besoin : le monter selon l'alimentation.
- Citrouille **méchante** : yeux en triangles rectangles « ◣ ◢ » (pente vers le nez), forme fixe : ils bougent (regard) et se ferment (petite barre). Les émotions passent uniquement par les sourcils, froncés « \ / » au repos (`EVIL`), tracés par paliers réguliers (pixel art).
- Bouche : suivi précis **inchangé** (l'opérateur tient aux micro-mouvements, surtout bouche presque fermée quand il parle : ne pas lisser ni filtrer davantage). Seuls ajouts : axe calé sur la grille de LED (décalage < 0,25 px, supprime les fausses asymétries de pixels) et symétrisation du seul bruit < 0,15 px (`SYM_NOISE`). Ajout du 2026-10-31 (artefacts de pixels) : au rendu, si la bouche est presque symétrique au pixel près, ouverte ou fermée, elle est rendue symétrique (couverture moyennée avec son reflet, gardée si ≤ 2 pixels ou 35 % de ses pixels changent, `SYM_PIX`) ; bouche fermée : un pixel isolé d'une rangée par rapport à ses deux voisins alignés est recalé sur eux. Une vraie asymétrie reste intacte. Largeur (2026-10-31, minimum jugé trop large) : dans `accentuate()`, une bouche plus étroite que le neutre est resserrée x2,4 (au lieu de x1,5, qui reste pour l'étirement), minimum 3 px.
- Son du micro de la carte son USB (carte 2, aussi utilisée pour la sortie JBL) sur le téléphone : `audio.js` capture avec `arecord` (PCM 16 bits, 16 kHz, mono, périodes de 20 ms) et l'envoie en binaire sur `/ws?role=audio` ; bouton « Son » sur l'image de la webcam (lecture Web Audio, réserve de 80 ms, gain + compresseur). Variable : `AUDIO_DEVICE`.
- Voix de l'opérateur -> haut-parleur du Pi (F3 + F9) : allumée par le mode « Manuel » ; micro du téléphone (annulation d'écho, réduction de bruit) rééchantillonné à 16 kHz et envoyé sur `/ws?role=voice`. `voice.js` applique un effet fixe, **voix de « lutin »** (2026-10-31, public de jeunes enfants : faire rire, pas peur) : +3,3 demi-tons (`FX.pitch` = 1,21, formants compris), présence vers 3 kHz, saturation très douce. Le décaleur de hauteur cale ses raccords sur la forme d'onde (corrélation, `MAX_LAG`) : sans ça, la voix montée sonnait « voix modifiée d'enquête criminelle ». **Pas d'écho** (la citrouille résonne déjà). Porte de bruit avec maintien de 350 ms (fins de mots). Essayés puis retirés : voix de monstre grave (sous-octave, voix rauque, grognement : trop flippante), voix d'hélium (+8 demi-tons), curseur de déformation et choix de style, modulation en anneau, doublage, formants par LPC, vibrato (robotique). Sortie : `son.js` (aplay) sur la carte son USB si présente, sinon la prise jack. Réglages : `FX` en haut de `voice.js` ; sortie forcée : `VOICE_DEVICE`.
- Calibrage du suivi : enregistre aussi le visage de repos du comédien pour les yeux et sourcils (blendshapes `eye*`/`brow*`, `cfg.base`), qui devient le zéro. Indispensable pour un comédien aux yeux naturellement plissés. La bouche n'est pas concernée.
- Trois modes (boutons alignés du backoffice, `mode` du serveur) : **Éteint** (`off`) = toutes les LED noires ; **Sommeil** (`idle`, `idleTarget` dans `face.js`) = tête classique de citrouille immobile : yeux ouverts, sourcils froncés au repos, bouche en demi-lune (`MOON`) ; **Manuel** (`live`) = allume la voix (même démarrage que l'ancien bouton « Voix ») puis la caméra du téléphone (suivi du visage) ; Éteint et Sommeil les coupent. Plus de boutons « Voix » ni « Activer le suivi » séparés ; une pastille sur l'image « Toi » indique l'état de la voix. Historique : la veille montrait une citrouille endormie (yeux fermés, respiration), remplacée le 2026-10-30. Firefox Android peut mettre plusieurs secondes à démarrer le son : `voStart` attend que le contexte audio tourne avant d'ouvrir le micro.
- **Sortie son unique** (`son.js`, une seule enceinte) : un seul aplay (44,1 kHz mono) joue le mélange voix + musique. La voix (16 kHz, après `voice.js`) est rééchantillonnée, avec une réserve de 60 ms contre le Wi-Fi et 300 ms de retard au plus. Le rythme vient de la carte son : `scripts/sortie_son.py` écrit chaque morceau de 20 ms dans un tube réduit à 4 Ko vers aplay et répond « . » ; Node garde au plus 2 morceaux en route (le stdin d'un processus lancé par Node est une socket, impossible à réduire, d'où ce relais). Aplay s'arrête 5 s après que la voix et la musique sont coupées.
- **Musique d'ambiance** : « Ghoulish Fun » d'Eric Matyas (soundimage.org, CC-BY 3.0, crédit dans `sons/CREDITS.txt`), boucle de 83 s dans `sons/musique.wav` (mono 16 bits 44,1 kHz, en mémoire). Case « Musique d'ambiance » et volume (défaut 25 %) dans la section « Son » ; boucle sans fin ; état gardé dans `son.json` (non versionné), donc repris après un redémarrage ; aplay relancé s'il s'arrête tout seul. Baissée à 30 % quand la voix parle (maintien 600 ms), gain lissé. Pas de décodeur OGG/MP3 sur le Pi : pour changer de musique, décoder ailleurs en WAV (ou `apt-get download vorbis-tools libvorbisfile3 libvorbis0a libogg0` + `dpkg -x`, sans sudo, puis `oggdec`) et la convertir en mono 44,1 kHz.
- Couleur des LED (2026-10-31) : bouton arc-en-ciel dans la rangée des blagues -> fenêtre de 9 couleurs (`LED_COLORS` du backoffice). `Face.setColor()` change la couleur unique de tout ce qui s'allume (visage et images) ; le serveur la garde dans `couleur.json` (non versionné) et la diffuse aux aperçus (`info.color`). Blanc par défaut.
- Pierre / feuille / ciseaux : trois boutons dessinés sous les modes du backoffice. Dessous, une rangée de boutons « blagues » dans le même style (pour l'instant « 2€40 », `prix`, chiffres 3x7 faits main) ; pour en ajouter : une entrée dans `ICONS` + un bouton `data-icon` dans `backoffice.html`. Dessins : glyphes ✊ ✋ ✌ de GNU Unifont (16x16, un même jeu ; les dessins faits main étaient moches). Un toucher affiche l'image (`ICONS` dans `face.js`, `Face.icon()`) à la place du visage pendant 2 s (`ICON_MS` dans `server.js`), quel que soit le mode, sur la matrice et les aperçus ; la voix et le suivi continuent en dessous.
- Sourcils (2026-10-31, suivi jugé trop faible) : course élargie dans `face.js` (levés jusqu'à 2 rangées, 3 avec les yeux écarquillés ; pente de −2 à +2 ; baissés, ils froncent davantage car ils n'ont pas la place de descendre ; toujours une LED éteinte entre sourcil et œil, le sourcil entier remonte au besoin). Mesure plus sensible dans le backoffice (gains ×1,4) + curseur « Sensibilité sourcils » (`cfg.gainBrow`).
- Pas de clignement automatique (`step(..., { autoBlink: false })`) : le sommeil est immobile, le mode manuel suit le comédien. Les sourcils sont placés par rapport à l'œil ouvert et figés côté mesure pendant le clignement de leur œil (MediaPipe fait croire à un sourcil qui descend).
- Synchro labiale : le serveur retarde le visage (cibles horodatées dans `targetQueue`) de `lipsyncMs`, 130 ms par défaut, réglable de 0 à 500 ms dans le backoffice (section « Son »), car le son arrive plus tard que l'image sur la citrouille. S'applique à tout ce qui affiche le visage (aperçu, rendu, future matrice).
- Mode debug de la voix (case « Debug » de la section « Son ») : la voix sort 2 s plus tard sur le haut-parleur (`DEBUG_DELAY` dans `voice.js`) et le visage est retardé d'autant, pour que l'opérateur parle puis s'écoute. État gardé par le serveur, non mémorisé : repart désactivé au redémarrage.
- Backoffice : écrans en haut de page, sans scroll (webcam du Pi ; dessous, caméra du téléphone + petit aperçu de la citrouille, toucher pour basculer LED/citrouille).

### Pas encore fait
- Matrice LED : pilote écrit (`leds.js` + `scripts/ws2812_spi.py`), à valider sur le matériel (câblage, orientation via la mire, puis `leds.json` si besoin).
- Carte son USB + ampli pour la citrouille : la voix sort pour l'instant sur la prise jack, qui sera gênée par les WS2812 pilotées en PWM. F1 à F3 fonctionnent sans WebRTC (MJPEG + PCM brut) ; ffmpeg et GStreamer ne sont pas installés sur le Pi.
- Code d'accès à la page (sécurité, cahier §6), F8 (animations d'attente poussées), F9 à F12.

## Matrice LED (WS2812B 16x16)

Pilotage par le **SPI** (pas en PWM : le PWM exige root et bloque la prise jack qui sort la voix).
`leds.js` convertit chaque image de `Face.render()` (40 images/s, même sans navigateur ouvert) en ordre GRB, applique luminosité, disposition et plafond de courant, puis `scripts/ws2812_spi.py` l'envoie sur `/dev/spidev0.0` (2,4 MHz, 3 bits SPI par bit WS2812, ~2,4 Ko par image).

Câblage (Pi éteint) :
- Alimentation **5 V dédiée** (4 A minimum) sur les gros fils +5 V / GND de la matrice. **Jamais** le 5 V du Pi.
- Condensateur 1000 µF (≥ 6,3 V) entre +5 V et GND, au plus près de la matrice.
- **Masse commune** : broche 6 du Pi (GND) -> GND de la matrice.
- **Données** : broche 19 du Pi (GPIO10, SPI0 MOSI) -> résistance 330 Ω -> **DIN** (entrée, côté flèche ; pas DOUT).
- Adaptateur de niveau 3,3 V -> 5 V conseillé (74AHCT125 : 14 = 5 V, 7 = GND, 1 = GND, 2 = entrée depuis la broche 19, 3 = sortie vers la résistance 330 Ω ; 4, 10, 13 au 5 V). Sans lui ça marche souvent avec un fil de données court ; sinon : couleurs aléatoires et scintillement.

Activation (une fois) : `sudo sh ~/living-pumpkin/scripts/activer-spi.sh`. Le script ajoute à `/boot/firmware/config.txt` `dtparam=spi=on`, `core_freq=250` et `core_freq_min=250` (horloge du cœur fixe = timing SPI stable, recommandé par rpi_ws281x pour le Pi 3). Il installe aussi le service systemd `citrouille` (démarrage automatique, redémarrage si plantage), puis redémarre le Pi. Guide de câblage pour le téléphone : `/branchement.html`. Pour recharger le code sans sudo : tuer le processus `node server.js`, systemd le relance.

Réglages : `leds.json` (voir l'en-tête de `leds.js` : `vertical`, `serpentine`, `rotate`, `flipX`, `flipY`, `brightness`, `maxMilliamps`, `enabled`). Backoffice, section « Matrice LED » : luminosité (défaut 100 %) et **mire de test** (ligne du haut, colonne de gauche, flèche vers le haut) pour régler l'orientation.

## Matériel (état réel)

- **Raspberry Pi 3B+** (1 Go de RAM, CPU 64 bits : OS 64 bits OK). Pas de Pi 4 contrairement au cahier.
- **OS prévu : Raspberry Pi OS Lite 64 bits**, sans interface graphique, Wi-Fi + SSH configurés via Raspberry Pi Imager.
- **Webcam USB Microsoft LifeCam VX-800** (retirée, remplacée par la caméra IR CSI ci-dessus ; ancien état) : vidéo `/dev/video0`, YUYV uniquement (pas de MJPEG), 640x480 maximum à 30 images/s ; micro = carte son ALSA 1 (`arecord -l`).
- **Micro USB** de bonne qualité disponible (secours ou meilleur micro).
- **Mini caméra analogique** 5~20 V à 3 fils (VID, GND, 5~20V), sortie composite, sans micro : inutilisable directement. Il faudrait un dongle USB de capture composite (puce MS2109 de préférence). Mise de côté, la webcam USB est plus simple.
- **Matrice** : WS2812 16x16 (256 LED). Possédée ou à acheter : à confirmer. Alimentation dédiée 5 V (jusqu'à ~15 A en blanc plein, luminosité à limiter), masses communes avec le Pi.
- **Enceintes** : il faudra une carte son USB (ou micro-casque USB). Piloter des WS2812 en PWM sur le Pi bloque aussi la sortie jack, une raison de plus.
- Boîtier étanche/ventilé, ampli, haut-parleurs : à acheter/choisir.

## Prochaines étapes (ordre conseillé)

1. Sur le Pi : cloner le dépôt, installer Node.js (LTS), `npm install`, `npm run cert`, `npm start`, ouvrir `render.html` et `backoffice.html` depuis un autre appareil du réseau pour valider la base.
2. Vérifier la détection de la webcam (commandes ci-dessus) et tester une capture vidéo + audio.
3. Ajouter le streaming WebRTC (F1 à F3). Attention : le Pi 3B+ est limité (1 Go) ; envisager ffmpeg/GStreamer (encodeur H.264 matériel du Pi) plutôt qu'une pile WebRTC 100 % Node.
4. Brancher la matrice WS2812 16x16, écrire le pilote qui consomme `Face.render()`.
5. Service systemd, code d'accès, montage dans la citrouille, test en extérieur.

## Structure du dépôt

```
server.js            serveur HTTP(S) + WebSocket (port 8080 par défaut, variable PORT)
camera.js            caméra IR du Pi -> flux MJPEG /cam.mjpg (rpicam-vid)
audio.js             micro du Pi -> téléphone (arecord, PCM brut sur /ws?role=audio)
leds.js              image du visage -> matrice WS2812 (disposition, luminosité, plafond de courant, mire)
scripts/ws2812_spi.py  envoi des images aux LED par le SPI (lancé par leds.js)
voice.js             voix de l'opérateur -> effet « lutin » -> son.js (/ws?role=voice)
son.js               sortie haut-parleur : mélange voix + musique d'ambiance (aplay via scripts/sortie_son.py)
sons/                musique d'ambiance (musique.wav) et crédits
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
