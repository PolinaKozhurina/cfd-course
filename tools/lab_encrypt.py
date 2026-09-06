# -*- coding: utf-8 -*-
"""
Шифрование тела лабораторной работы (AES-256-GCM).

Открытый текст заданий хранится вне репозитория: nm/_private/wNN-lab.body.html
(папка nm/_private/ в .gitignore). В репозиторий попадает только шифртекст
nm/wNN-lab.enc.json; ключ — в файле nm/_private/wNN-lab.key (тоже вне git),
его же преподаватель вводит один раз в админке (вкладка «Лабы» → ключ).

Использование:
    python tools/lab_encrypt.py nm/_private/w01-lab.body.html nm/w01-lab.enc.json
        (ключ читается из nm/_private/w01-lab.key; если файла нет — создаётся новый)
    python tools/lab_encrypt.py --decrypt nm/w01-lab.enc.json out.html
        (восстановить открытый текст из шифртекста по ключу)

Формат enc.json: {"v":1,"alg":"AES-GCM","iv":base64(12 байт),"ct":base64}.
Расшифровка в браузере — js/labs.js (WebCrypto), ключ приходит из Firestore
lab_keys/{cid}_{lab} только допущенным пользователям.
"""
import base64, io, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def key_path_for(body_path):
    base = os.path.basename(body_path).replace('.body.html', '').replace('.enc.json', '')
    return os.path.join(os.path.dirname(body_path), base + '.key')


def load_or_make_key(kpath):
    if os.path.exists(kpath):
        return io.open(kpath, encoding='utf-8').read().strip()
    key = base64.b64encode(os.urandom(32)).decode('ascii')
    os.makedirs(os.path.dirname(kpath) or '.', exist_ok=True)
    io.open(kpath, 'w', encoding='utf-8').write(key + '\n')
    print('created new key:', kpath)
    return key


def encrypt(body_path, out_path):
    key = load_or_make_key(key_path_for(body_path))
    pt = io.open(body_path, encoding='utf-8').read().encode('utf-8')
    iv = os.urandom(12)
    ct = AESGCM(base64.b64decode(key)).encrypt(iv, pt, None)
    io.open(out_path, 'w', encoding='utf-8').write(json.dumps({
        'v': 1, 'alg': 'AES-GCM',
        'iv': base64.b64encode(iv).decode('ascii'),
        'ct': base64.b64encode(ct).decode('ascii'),
    }))
    print('encrypted %d bytes -> %s' % (len(pt), out_path))
    print('key (paste into admin → Лабы → ключ):', key)


def decrypt(enc_path, out_path, key_file):
    key = io.open(key_file, encoding='utf-8').read().strip()
    enc = json.load(io.open(enc_path, encoding='utf-8'))
    pt = AESGCM(base64.b64decode(key)).decrypt(base64.b64decode(enc['iv']), base64.b64decode(enc['ct']), None)
    io.open(out_path, 'wb').write(pt)
    print('decrypted -> %s (%d bytes)' % (out_path, len(pt)))


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__); sys.exit(0)
    if a[0] == '--decrypt':
        enc_path, out_path = a[1], a[2]
        key_file = a[3] if len(a) > 3 else os.path.join(os.path.dirname(enc_path), '_private', os.path.basename(enc_path).replace('.enc.json', '.key'))
        decrypt(enc_path, out_path, key_file)
    else:
        encrypt(a[0], a[1])
