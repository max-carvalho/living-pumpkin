#!/bin/sh
# Test direct de la matrice, sans passer par le code de la citrouille :
# N lignes du haut (16 LED par ligne, défaut 1) en blanc à 100 % pendant 10 s, sans limite de courant.
# Exemple : sh scripts/test-leds.sh 3
# Le serveur reprend la main tout seul juste après.
pkill -f "scripts/ws2812_spi.py"
sleep 0.3
python3 - "${1:-1}" <<'EOF'
import os, sys, time
import fcntl, struct
fd = os.open('/dev/spidev0.0', os.O_WRONLY)
fcntl.ioctl(fd, 0x40016B01, struct.pack('B', 0))
fcntl.ioctl(fd, 0x40016B03, struct.pack('B', 8))
fcntl.ioctl(fd, 0x40046B04, struct.pack('I', 2400000))
LUT = []
for v in range(256):
    bits = 0
    for i in range(7, -1, -1):
        bits = (bits << 3) | (0b110 if (v >> i) & 1 else 0b100)
    LUT.append(bits.to_bytes(3, 'big'))
rows = int(sys.argv[1])
frame = bytes([255] * 16 * rows * 3) + bytes((16 - rows) * 16 * 3)
data = b''.join(LUT[b] for b in frame) + bytes(100)
print('%d LED en blanc à 100 %% pendant 10 s...' % (16 * rows))
end = time.time() + 10
while time.time() < end:
    os.write(fd, data)
    time.sleep(0.02)
os.close(fd)
print('Fini.')
EOF
