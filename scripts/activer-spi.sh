#!/bin/sh
# À lancer UNE fois avec sudo :  sudo sh ~/living-pumpkin/scripts/activer-spi.sh
#  1. active le bus SPI (matrice WS2812 sur la broche 19) avec une horloge fixe (timing stable) ;
#  2. installe le service « citrouille » : le serveur démarre tout seul à chaque allumage du Pi
#     et redémarre s'il s'arrête ;
#  3. redémarre le Pi.
set -e
CFG=/boot/firmware/config.txt
DIR=/home/mcarvalho/living-pumpkin

if ! grep -q '^dtparam=spi=on' "$CFG"; then
  printf '\n# Citrouille : matrice WS2812 sur le SPI (broche 19), horloge fixe pour un timing stable\ndtparam=spi=on\ncore_freq=250\ncore_freq_min=250\n' >> "$CFG"
  echo "SPI activé dans $CFG"
else
  echo "SPI déjà activé"
fi

cat > /etc/systemd/system/citrouille.service <<EOF
[Unit]
Description=Citrouille qui parle (serveur Node)
After=network-online.target sound.target
Wants=network-online.target

[Service]
User=mcarvalho
WorkingDirectory=$DIR
Environment=PATH=/home/mcarvalho/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=/home/mcarvalho
ExecStart=/home/mcarvalho/.local/bin/node server.js
StandardOutput=append:$DIR/server.log
StandardError=append:$DIR/server.log
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable citrouille.service
echo "Service citrouille installé (démarrage automatique)"

echo "Redémarrage du Pi..."
reboot
