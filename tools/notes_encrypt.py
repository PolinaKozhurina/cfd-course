# -*- coding: utf-8 -*-
"""
Шифрование заметок докладчика в колоде слайдов (AES-256-GCM).

Заметки (<aside class="notes" hidden>…</aside> в каждой <section class="slide">)
вынимаются из страницы и хранятся вне репозитория в
nm/_private/wNN-slides.notes.html — по одному <aside> на слайд, в порядке слайдов.
В репозиторий попадает только шифртекст nm/wNN-slides.notes.enc.json.
Ключ один на курс: nm/_private/<cid>-notes.key (вне git) — его же преподаватель
вводит один раз в админке (вкладка «Лабы» → «Ключ заметок докладчика»).
js/slide-notes.js после входа admin читает ключ из Firestore notes_keys/<cid>
и расшифровывает заметки в браузере.

Использование:
    python tools/notes_encrypt.py nm/w01-slides.html
        — если в странице ещё есть <aside class="notes">, они вынимаются в
          nm/_private/w01-slides.notes.html и удаляются из страницы;
          затем (всегда) nm/_private/w01-slides.notes.html шифруется в
          nm/w01-slides.notes.enc.json.
    Правка заметок: редактировать nm/_private/w01-slides.notes.html и снова
    запустить команду.
"""
import base64, io, json, os, re, sys
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ASIDE = re.compile(r'[ \t]*<aside class="notes" hidden>.*?</aside>\n?', re.S)


def main(page):
    d = os.path.dirname(page)
    base = os.path.basename(page).replace('.html', '')
    html = io.open(page, encoding='utf-8').read()
    cid = re.search(r'data-course="([a-z0-9]+)"', html).group(1)
    priv = os.path.join(d, '_private')
    os.makedirs(priv, exist_ok=True)
    src = os.path.join(priv, base + '.notes.html')
    asides = ASIDE.findall(html)
    if asides:
        nslides = html.count('<section class="slide')
        assert len(asides) == nslides, 'aside/slide mismatch: %d vs %d' % (len(asides), nslides)
        io.open(src, 'w', encoding='utf-8', newline='\n').write(
            ''.join('<!-- slide %d -->\n%s\n' % (i + 1, a.strip()) for i, a in enumerate(asides)))
        html = ASIDE.sub('', html)
        io.open(page, 'w', encoding='utf-8', newline='\n').write(html)
        print('extracted %d notes -> %s; removed from page' % (len(asides), src))
    notes = [m.strip() for m in re.findall(r'<aside class="notes" hidden>.*?</aside>', io.open(src, encoding='utf-8').read(), re.S)]
    inner = [re.sub(r'^<aside class="notes" hidden>|</aside>$', '', n) for n in notes]
    kpath = os.path.join(priv, cid + '-notes.key')
    if os.path.exists(kpath):
        key = io.open(kpath, encoding='utf-8').read().strip()
    else:
        key = base64.b64encode(os.urandom(32)).decode('ascii')
        io.open(kpath, 'w', encoding='utf-8').write(key + '\n')
        print('created new course notes key:', kpath)
    pt = json.dumps(inner, ensure_ascii=False).encode('utf-8')
    iv = os.urandom(12)
    ct = AESGCM(base64.b64decode(key)).encrypt(iv, pt, None)
    out = os.path.join(d, base + '.notes.enc.json')
    io.open(out, 'w', encoding='utf-8').write(json.dumps({'v': 1, 'alg': 'AES-GCM', 'n': len(inner),
        'iv': base64.b64encode(iv).decode('ascii'), 'ct': base64.b64encode(ct).decode('ascii')}))
    print('encrypted %d notes (%d bytes) -> %s' % (len(inner), len(pt), out))
    print('course notes key (admin → Лабы → ключ заметок):', key)


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        print(__doc__); sys.exit(0)
    main(sys.argv[1])
