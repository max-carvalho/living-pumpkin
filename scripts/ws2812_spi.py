#!/usr/bin/env python3
# Pilote bas niveau des LED WS2812 par le bus SPI du Raspberry Pi (broche 19 = GPIO10 = MOSI).
# Lancé par leds.js : lit sur l'entrée standard des images de N*3 octets (ordre GRB, déjà
# dimensionnées et corrigées) et les envoie à la matrice.
#
# Principe : à 2,4 MHz, chaque bit WS2812 devient 3 bits SPI : 0 -> 100 (0,42 µs haut),
# 1 -> 110 (0,83 µs haut). Une image de 256 LED fait 2304 octets SPI, envoyés d'un bloc (DMA,
# donc sans trou entre les octets), suivis de zéros (> 300 µs à l'état bas = « reset »).
# Python plutôt que Node : il faut des ioctl pour régler la vitesse du SPI, et le réglage ne
# vaut que tant que le périphérique reste ouvert par le même processus.
import fcntl, os, struct, sys

dev = sys.argv[1] if len(sys.argv) > 1 else '/dev/spidev0.0'
count = int(sys.argv[2]) if len(sys.argv) > 2 else 256
SPEED = 2400000
FRAME = count * 3

SPI_IOC_WR_MODE = 0x40016B01
SPI_IOC_WR_BITS_PER_WORD = 0x40016B03
SPI_IOC_WR_MAX_SPEED_HZ = 0x40046B04

try:
    fd = os.open(dev, os.O_WRONLY)
except OSError as e:
    sys.stderr.write('SPI indisponible (%s) : %s\n' % (dev, e.strerror))
    sys.exit(2)
fcntl.ioctl(fd, SPI_IOC_WR_MODE, struct.pack('B', 0))
fcntl.ioctl(fd, SPI_IOC_WR_BITS_PER_WORD, struct.pack('B', 8))
fcntl.ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, struct.pack('I', SPEED))

# Table : octet de couleur -> 3 octets SPI (8 bits WS2812 x 3 bits SPI = 24 bits).
LUT = []
for v in range(256):
    bits = 0
    for i in range(7, -1, -1):
        bits = (bits << 3) | (0b110 if (v >> i) & 1 else 0b100)
    LUT.append(bits.to_bytes(3, 'big'))
RESET = bytes(100)  # 100 octets à 0 = 333 µs à l'état bas


def show(frame):
    os.write(fd, b''.join(LUT[b] for b in frame) + RESET)


stdin = sys.stdin.buffer
try:
    while True:
        frame = stdin.read(FRAME)
        if len(frame) < FRAME:
            break
        show(frame)
finally:
    # Fin du serveur (entrée fermée) : on éteint tout.
    try:
        show(bytes(FRAME))
    except OSError:
        pass
    os.close(fd)
