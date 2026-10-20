"""번역 — 말.통과 같은 Google 번역 gtx 엔드포인트 (무료·키 불필요). 문장 하나씩 보내 시간축과 1:1 로 맞춘다."""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

GTX = 'https://translate.googleapis.com/translate_a/single'
_cache = {}


def translate_one(text, source, target, retries=5):
    key = (source, target, text)
    if key in _cache:
        return _cache[key]
    query = urllib.parse.urlencode({'client': 'gtx', 'sl': source, 'tl': target, 'dt': 't', 'q': text})
    for attempt in range(retries):
        try:
            req = urllib.request.Request(f'{GTX}?{query}', headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=20) as res:
                data = json.loads(res.read().decode('utf-8'))
            # 긴 문장은 여러 조각으로 오므로 전부 이어 붙인다
            out = ''.join(c[0] for c in (data[0] or []) if c and isinstance(c[0], str)).strip()
            _cache[key] = out
            return out
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(1.5 * 2 ** attempt)  # 429·네트워크 오류는 점점 길게 쉬었다가 다시
    return ''


def translate_all(texts, source, target, workers=4, on_progress=None, is_canceled=lambda: False):
    done = 0
    lock = threading.Lock()
    out = [''] * len(texts)

    def work(i):
        nonlocal done
        if is_canceled():
            return
        out[i] = translate_one(texts[i], source, target) or texts[i]  # 실패해도 빈칸 대신 원문
        with lock:
            done += 1
            if on_progress:
                on_progress(done / len(texts))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(work, range(len(texts))))
    return out
