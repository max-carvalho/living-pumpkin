#!/usr/bin/env python3
# Relais entre son.js et aplay : la carte son donne le rythme, sans accumuler de retard.
# Usage : sortie_son.py TAILLE aplay [options...]
# Lit des morceaux de TAILLE octets sur stdin, les écrit dans un tube réduit à 4 Ko vers aplay
# (écriture bloquante tant qu'aplay n'a pas fait de place), puis répond « . » sur stdout :
# son.js n'envoie un nouveau morceau qu'à réception de ce signal.
# (Le stdin venant de Node est une socket : on ne peut pas réduire son tampon, d'où ce relais.)
import fcntl, os, subprocess, sys

size = int(sys.argv[1])
r, w = os.pipe()
fcntl.fcntl(w, fcntl.F_SETPIPE_SZ, 4096)
player = subprocess.Popen(sys.argv[2:], stdin=r)
os.close(r)
inp, out = sys.stdin.buffer, sys.stdout.buffer
try:
    while True:
        data = inp.read(size)
        if not data:
            break
        view = memoryview(data)
        while view:
            view = view[os.write(w, view):]
        out.write(b'.')
        out.flush()
except (BrokenPipeError, KeyboardInterrupt):
    pass
finally:
    os.close(w)
    player.terminate()
    sys.exit(player.wait() or 0)
