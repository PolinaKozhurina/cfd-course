# -*- coding: utf-8 -*-
"""
Загрузка вопросов теста в Firestore (то же, что кнопка «Загрузить JSON» во вкладке
«Тесты» админки) — через ключ сервис-аккаунта, без входа на сайт.

    python tools/quiz_upload.py <курс> <id теста> <вопросы.json> <ключ-сервис-аккаунта.json>
    пример: python tools/quiz_upload.py nm t01 nm/_private/quiz_nm_t01.json ~/Downloads/cfd-course-firebase-adminsdk-*.json

Пишет quiz_sessions/{курс}_{id}: title, durationSec, questions (состояние сеанса —
open, allowedUids, showAnswers — не трогает) и quiz_keys/{курс}_{id}: answers,
explanations. Формат JSON — см. js/quiz.js. Файл с вопросами хранить вне репозитория.
"""
import json, sys, urllib.request, datetime

PROJECT = 'cfd-course'
BASE = 'https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents/' % PROJECT


def token(key_path):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_file(key_path, scopes=['https://www.googleapis.com/auth/datastore'])
    creds.refresh(Request())
    return creds.token


def val(v):
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [val(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: val(x) for k, x in v.items()}}}
    if isinstance(v, datetime.datetime): return {'timestampValue': v.strftime('%Y-%m-%dT%H:%M:%S.%fZ')}
    raise TypeError(type(v))


def patch(tok, path, fields):
    mask = '&'.join('updateMask.fieldPaths=' + k for k in fields)
    req = urllib.request.Request(BASE + path + '?' + mask, method='PATCH',
                                 data=json.dumps({'fields': {k: val(v) for k, v in fields.items()}}).encode(),
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)


def main(argv):
    if len(argv) != 4: sys.exit(__doc__)
    cid, qid, src, key = argv
    d = json.load(open(src, encoding='utf-8'))
    qs, ans = d['questions'], d['answers']
    assert len(qs) == len(ans) and qs, 'число вопросов и ответов не совпадает'
    for i, (q, a) in enumerate(zip(qs, ans)):
        assert q['text'] and len(q['options']) >= 2 and 0 <= a < len(q['options']), 'вопрос %d' % (i + 1)
    tok = token(key)
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    patch(tok, 'quiz_sessions/%s_%s' % (cid, qid), {
        'courseId': cid, 'quizId': qid, 'title': d.get('title', qid), 'durationSec': int(d.get('durationSec', 900)),
        'questions': [{'text': q['text'], 'options': list(q['options'])} for q in qs],
        'updatedAt': now, 'updatedBy': 'tools/quiz_upload.py'})
    patch(tok, 'quiz_keys/%s_%s' % (cid, qid), {
        'answers': [int(a) for a in ans], 'explanations': list(d.get('explanations', [])),
        'updatedAt': now, 'updatedBy': 'tools/quiz_upload.py'})
    print('загружено: %s_%s, вопросов %d, время %d мин' % (cid, qid, len(qs), int(d.get('durationSec', 900)) // 60))


if __name__ == '__main__':
    main(sys.argv[1:])
