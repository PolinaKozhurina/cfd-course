# -*- coding: utf-8 -*-
"""
Деплой firestore.rules в проект Firebase через Firebase Rules API
(без firebase-tools/Node — нужен только ключ сервис-аккаунта).

Использование:
    python tools/deploy_rules.py --check <ключ-сервис-аккаунта.json>
        показать, какой набор правил сейчас в проде и совпадает ли он с локальным файлом
    python tools/deploy_rules.py <ключ-сервис-аккаунта.json>
        создать ruleset из firestore.rules и переключить на него релиз cloud.firestore

Ключ сервис-аккаунта (Firebase Console → Настройки проекта → Сервисные аккаунты →
«Создать закрытый ключ») хранить вне репозитория. Нужны pip-пакеты google-auth.
Синтаксис правил проверяет CI (эмулятор, слой 2) — деплоить только после зелёного CI.
Откат: запустить с --release <имя старого ruleset> (печатается в --check).
"""
import io, json, os, sys, time, urllib.error, urllib.request

PROJECT = 'cfd-course'
API = 'https://firebaserules.googleapis.com/v1/'
RULES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'firestore.rules')


def token(key_path):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_file(
        key_path, scopes=['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'])
    creds.refresh(Request())
    return creds.token


def call(tok, method, path, body=None, tries=4):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, data=data, method=method, headers=headers), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            sys.exit('HTTP %s %s' % (e.code, e.read().decode('utf-8')[:800]))
        except Exception as e:  # сетевой таймаут — повторить
            print('retry', k + 1, type(e).__name__)
            time.sleep(5)
    sys.exit('network failed')


def main(argv):
    check = '--check' in argv
    release_to = argv[argv.index('--release') + 1] if '--release' in argv else None
    args = [a for a in argv if not a.startswith('--') and a != release_to]
    if not args:
        sys.exit(__doc__)
    tok = token(args[0])
    local = io.open(RULES, encoding='utf-8').read()
    rel = call(tok, 'GET', 'projects/%s/releases/cloud.firestore' % PROJECT)
    cur = rel.get('rulesetName')
    live = call(tok, 'GET', cur)['source']['files'][0]['content']
    print('live ruleset :', cur, rel.get('updateTime'))
    print('live == local:', live == local)
    if check:
        return
    if release_to:
        new = release_to
    elif live == local:
        print('нечего деплоить'); return
    else:
        rs = call(tok, 'POST', 'projects/%s/rulesets' % PROJECT,
                  {'source': {'files': [{'name': 'firestore.rules', 'content': local}]}})
        new = rs['name']; print('new ruleset  :', new, rs.get('createTime'))
    call(tok, 'PATCH', 'projects/%s/releases/cloud.firestore' % PROJECT,
         {'release': {'name': 'projects/%s/releases/cloud.firestore' % PROJECT, 'rulesetName': new}})
    chk = call(tok, 'GET', 'projects/%s/releases/cloud.firestore' % PROJECT)
    got = call(tok, 'GET', new)['source']['files'][0]['content']
    print('release now  :', chk.get('rulesetName'), chk.get('updateTime'))
    print('verify: release matches =', chk.get('rulesetName') == new, '| content == local =', got == local)


if __name__ == '__main__':
    main(sys.argv[1:])
