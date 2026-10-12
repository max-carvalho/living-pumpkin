# Cahier des charges — Citrouille qui parle

## 1. Objectif

Pour Halloween, installer devant la maison une citrouille « vivante » : une personne la contrôle à distance depuis un téléphone. Elle voit et entend les passants, leur parle, et la citrouille reproduit ses expressions faciales sur une matrice de LED.

## 2. Description générale

- Une vraie citrouille (ou synthétique, voir §8), évidée pour que la paroi soit fine et translucide.
- À l'intérieur : une matrice de LED affichant yeux, sourcils et bouche animés.
- Un Raspberry Pi relié à une matrice LED, des enceintes, une caméra et un micro, et qui héberge un serveur web.
- Un téléphone (l'opérateur) qui se connecte à la page web du Pi.

## 3. Fonctionnalités

### 3.1 Indispensables (MVP)
- **F1** : le téléphone voit la vidéo de la caméra de la citrouille.
- **F2** : le téléphone entend le micro de la citrouille.
- **F3** : la voix de l'opérateur sort par les enceintes de la citrouille.
- **F4** : la bouche de la citrouille s'ouvre en fonction de la voix (volume), même sans suivi du visage.
- **F5** : la page web s'ouvre sur le téléphone sans installer d'application.

### 3.2 Importantes
- **F6** : analyse du visage de l'opérateur sur le téléphone (MediaPipe Face Landmarker) et envoi des valeurs d'expression (ouverture de la bouche, clignement, sourcils, sourire) au Pi.
- **F7** : la matrice reproduit ces expressions en temps réel.
- **F8** : animations d'attente quand personne ne contrôle (clignements, regards, ronflement...).

### 3.3 Optionnelles
- **F9** : effet de voix (grave, démoniaque) appliqué à la voix de l'opérateur.
- **F10** : boutons de sons et d'expressions préenregistrés (rire, cri, clin d'œil).
- **F11** : détection de mouvement : la citrouille réagit quand quelqu'un approche.
- **F12** : enregistrement d'un message de secours si le téléphone est déconnecté.

## 4. Architecture

```
Téléphone (navigateur)                       Raspberry Pi (dans la citrouille)
┌─────────────────────────┐   WebRTC     ┌────────────────────────────────┐
│ Page web                │◄────────────►│ Serveur web (HTTPS)            │
│  - vidéo + audio reçus  │  audio/vidéo │  - flux caméra + micro         │
│  - micro envoyé         │              │  - lecture audio (enceintes)   │
│  - MediaPipe (visage)   │  WebSocket   │  - réception des expressions   │
│  → valeurs d'expression ├─────────────►│  - rendu de la matrice LED     │
└─────────────────────────┘              └────────────────────────────────┘
```

Principe : l'analyse du visage se fait sur le téléphone, et seuls quelques nombres (blendshapes) transitent vers le Pi. Le Pi ne fait aucun traitement d'image lourd.

## 5. Matériel (à valider)

| Élément | Option envisagée | Remarque |
|---|---|---|
| Ordinateur | Raspberry Pi 4 (2 Go ou plus) | Pi 5 possible, support HUB75 moins éprouvé |
| Matrice LED | HUB75 64x32 **ou** WS2812 16x16 / 8x32 | À choisir (voir §9) |
| Caméra | Module caméra Pi ou webcam USB | Grand angle de préférence |
| Micro | Micro USB ou carte son USB | Placé près d'une ouverture |
| Enceintes | Petit ampli (PAM8403 ou similaire) + haut-parleurs | Carte son USB conseillée |
| Alimentation | 5 V, 4 A minimum (selon matrice) | Rallonge extérieure étanche |
| Boîtier | Boîtier étanche et ventilé pour le Pi | Protéger de l'humidité et de la chaleur |
| Réseau | Wi-Fi maison ou point d'accès dédié | Vérifier la portée jusqu'à la porte |

## 6. Contraintes techniques

- **HTTPS obligatoire** : sans connexion sécurisée, le navigateur bloque l'accès au micro et à la caméra du téléphone (certificat auto-signé, mkcert ou Tailscale).
- **Latence** : cible inférieure à 300 ms pour la voix et inférieure à 100 ms pour les expressions.
- **Autonomie logicielle** : le service démarre tout seul au branchement du Pi (systemd).
- **Robustesse** : reconnexion automatique du téléphone, bouche pilotée par le volume en secours.
- **Environnement** : humidité, pluie, froid nocturne (octobre) et chaleur du Pi dans un volume clos.
- **Sécurité** : page protégée par un code d'accès pour que les voisins ne puissent pas prendre le contrôle.

## 7. Planning (Halloween : 31 octobre)

| Étape | Contenu | Échéance indicative |
|---|---|---|
| 1 | Commande du matériel | Cette semaine |
| 2 | Pi + HTTPS + page web, audio dans les deux sens (F1 à F3, F5) | J+5 |
| 3 | Matrice : yeux et bouche animés, bouche pilotée par la voix (F4) | J+9 |
| 4 | Suivi du visage et expressions (F6, F7) | J+14 |
| 5 | Montage dans la citrouille, test en extérieur | J+17 |
| 6 | Finitions : animations d'attente, effets de voix (F8 à F10) | J+19 |

## 8. Risques

- **Délai de livraison** du matériel (commander rapidement).
- **Pourrissement** d'une vraie citrouille évidée : la creuser au plus tard 2 à 3 jours avant, ou utiliser une citrouille synthétique pour l'électronique et une vraie pour l'effet visuel.
- **Surchauffe** du Pi et de la matrice en espace clos.
- **Pluie** sur l'électronique et les branchements.
- **Couverture Wi-Fi** insuffisante devant la maison.
- **Rendu lumineux** à travers la chair : à tester tôt avec une vraie citrouille.

## 9. Points ouverts

1. Quel modèle de Raspberry Pi possède-t-on déjà ?
2. Matrice HUB75 (plus lumineuse, plus complexe) ou WS2812 (plus simple, moins définie) ?
3. Langage du serveur : Python (aiortc) ou Node.js ?
4. Le téléphone sera-t-il toujours sur le Wi-Fi de la maison, ou faut-il un accès à distance (Tailscale) ?
5. Vraie citrouille, synthétique, ou les deux ?
6. Quelles expressions faut-il reproduire en priorité : bouche, yeux, sourcils ?
7. Budget total visé ?
