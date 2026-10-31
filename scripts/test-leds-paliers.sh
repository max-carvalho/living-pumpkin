#!/bin/sh
# Test de chute de luminosité, mains libres : allume 1, 2, 3 puis 4 lignes de LED en blanc à 100 %
# (une de plus par seconde), éteint 1 s, et recommence pendant 2 minutes.
# Si chaque LED faiblit à mesure qu'on en allume plus, le courant n'arrive pas (alim ou contact).
# Le serveur est mis en pause pendant le test (sinon il réécrit le visage) puis repart tout seul.
NODE=$(pgrep -f "^/home/mcarvalho/.local/bin/node server.js$")
[ -n "$NODE" ] && kill -STOP $NODE
trap '[ -n "$NODE" ] && kill -CONT $NODE' EXIT INT TERM
python3 - <<'EOF'
import os, time, fcntl, struct
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
def frame(rows):
    px = bytes([255] * 16 * rows * 3) + bytes((16 - rows) * 16 * 3)
    return b''.join(LUT[b] for b in px) + bytes(100)
FRAMES = [frame(r) for r in (1, 2, 3, 4, 0)]
end = time.time() + 120
try:
    while time.time() < end:
        for f in FRAMES:
            t = time.time() + 1
            while time.time() < t:
                os.write(fd, f)
                time.sleep(0.02)
finally:
    os.write(fd, FRAMES[-1])
    os.close(fd)
EOF
