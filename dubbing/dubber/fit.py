"""번역 길이 맞추기 — 더빙 문장이 원래 말한 시간 안에 들어가게 한다 (더빙 업계의 '등시성').

1) 언어별 말 속도(글자/초)로 번역문이 걸릴 시간을 어림하고
2) 원래 시간보다 길면 로컬 AI(Ollama · Gemma)에게 같은 뜻으로 더 짧게 다시 쓰게 한다.
말 속도는 실제로 만든 소리에서 배워(.rates.json) 다음 작업부터 어림이 정확해진다.
Ollama 가 없으면(Colab 등) 2) 를 건너뛰고, 편집 화면에서 사람이 줄인다.
"""
import json
import os
import re
import threading
import urllib.request
from pathlib import Path

# Chatterbox 기본 말투(cfg 0.5)에서 잰 값 — 걸리는 시간 ≈ 기본 시간 + 글자 수 / 말 속도
# (글자 수는 문장부호·공백을 뺀 것. 짧은 줄도 숨·끝맺음 때문에 0.6초쯤은 걸린다)
# 실측(MacBook Air M4): 영어 0.61초 + 글자/15.6, 중국어는 느리게 읽는 경우를 빼면 0.6초 + 글자/7
DEFAULT_SPEECH = {
    'en': (0.6, 15.5), 'es': (0.6, 14.0), 'fr': (0.6, 14.0), 'de': (0.6, 13.5),
    'ja': (0.6, 7.5), 'zh': (0.6, 7.0), 'ko': (0.5, 7.0),
}
RATES_FILE = Path(__file__).resolve().parent.parent / '.rates.json'
SOFT_SPEED = 1.1  # 이 정도 빠르기까지는 자연스럽다 — 더 걸리면 줄인다
OLLAMA = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434')
# gemma4 가 뜻을 더 잘 지킨다 (실측: gemma3 는 짧지만 단어를 빠뜨림). DUB_LLM 으로 바꿀 수 있다.
PREFERRED = ['gemma4:e2b', 'gemma3:latest', 'gemma3:4b', 'qwen2.5:7b']
LANG_NAME = {'en': 'English', 'zh': 'Simplified Chinese', 'ja': 'Japanese', 'es': 'Spanish',
             'de': 'German', 'fr': 'French', 'ko': 'Korean'}

_lock = threading.Lock()
_learned = None


def units(text):
    """말할 분량 — 문장부호·공백을 뺀 글자 수."""
    return len(re.sub(r'[\W_]+', '', text or ''))


def _load():
    global _learned
    if _learned is None:
        try:
            _learned = json.loads(RATES_FILE.read_text())
        except Exception:
            _learned = {}
    return _learned


def _fit(lang):
    """(기본 시간, 말 속도) — 실제 만든 소리 기록이 쌓이면 기본값을 약하게 섞은 회귀로 고친다."""
    base, rate = DEFAULT_SPEECH.get(lang, (0.6, 10.0))
    samples = _load().get(lang, {}).get('samples', [])
    if len(samples) < 4:
        return base, rate
    prior = [(u, base + u / rate) for u in (6, 20, 40)] * 2  # 기록이 적을 때 크게 흔들리지 않게
    xs, ys = zip(*(samples + prior))
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 1 / rate
    a = my - b * mx
    if b <= 0:
        return base, rate
    return max(0.2, min(1.5, a)), max(2.0, min(40.0, 1 / b))


def speech():
    """언어별 {overhead, rate} — 편집 화면이 같은 식으로 어림한다."""
    return {k: dict(zip(('overhead', 'rate'), (round(v, 3) for v in _fit(k)))) for k in DEFAULT_SPEECH}


def estimate(text, lang):
    base, rate = _fit(lang)
    n = units(text)
    return base + n / rate if n else 0.0


def learn(lang, text, seconds):
    """실제로 만든 소리 길이(쉼 줄인 뒤, 배속 전)를 기록해 다음 어림을 고친다."""
    n = units(text)
    if n < 2 or seconds < 0.3:
        return
    with _lock:
        d = _load()
        cur = d.setdefault(lang, {})
        cur['samples'] = (cur.get('samples', []) + [[n, round(seconds, 3)]])[-300:]
        try:
            RATES_FILE.write_text(json.dumps(d))
        except Exception:
            pass


def slots(segments, total):
    """문장마다 쓸 수 있는 시간 = 다음 문장이 시작하기 전까지 (뒤따르는 쉼 포함)."""
    out = []
    for i, s in enumerate(segments):
        nxt = segments[i + 1]['start'] if i + 1 < len(segments) else max(total, s['end'])
        out.append(max(0.3, nxt - s['start']))
    return out


def too_long(text, lang, slot):
    return estimate(text, lang) > slot * SOFT_SPEED


# ── 로컬 AI ───────────────────────────────────────────────

def _api(path, body=None, timeout=180):
    req = urllib.request.Request(f'{OLLAMA}{path}', json.dumps(body).encode() if body else None,
                                 {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def llm_model():
    """쓸 수 있는 모델 이름, 없으면 None (Ollama 가 꺼져 있거나 모델이 없음)."""
    try:
        names = [m['name'] for m in _api('/api/tags', timeout=3).get('models', [])]
    except Exception:
        return None
    want = os.environ.get('DUB_LLM')
    if want:
        return want if want in names else None
    return next((m for m in PREFERRED if m in names), None)


def unload(model):
    """번역이 끝나면 메모리를 비워 목소리 합성 모델에 자리를 내준다."""
    try:
        _api('/api/generate', {'model': model, 'keep_alive': 0}, timeout=10)
    except Exception:
        pass


def _ask(model, src_text, src_lang, text, lang, seconds, max_units, glossary):
    name = LANG_NAME.get(lang, lang)
    terms = f'Keep these terms exactly: {glossary}.\n' if glossary.strip() else ''
    prompt = (
        f'You are a professional dubbing translator. Rewrite the {name} line so it can be spoken naturally '
        f'in about {seconds:.1f} seconds — at most {max_units} letters, not counting spaces or punctuation. '
        f'It must stay a faithful translation of the {LANG_NAME.get(src_lang, src_lang)} original: keep every number, '
        f'floor or level name (e.g. B1, 2nd floor), name and technical term exactly, and never add or guess new meaning. '
        f'Use natural spoken {name}; drop only filler words and repetition.\n{terms}'
        f'Original: {src_text}\nCurrent {name} line: {text}\nReply as JSON: {{"text": "..."}}'
    )
    r = _api('/api/chat', {'model': model, 'messages': [{'role': 'user', 'content': prompt}], 'format': 'json',
                           'stream': False, 'options': {'temperature': 0.2}, 'keep_alive': '5m'})
    out = json.loads(r['message']['content']).get('text', '')
    return out.strip().strip('"').strip() if isinstance(out, str) else ''


def shorten(src_text, src_lang, text, lang, slot, glossary='', model=None):
    """
    원래 시간(slot초)에 맞게 줄인 번역문. 줄이지 못하면 None.
    한 번에 목표를 못 맞추면 더 짧게 한 번 더 시도하고, 가장 짧은 것을 고른다.
    """
    model = model or llm_model()
    if not model:
        return None
    base, rate = _fit(lang)
    budget = max(2, int((slot - base) * rate))
    best = None
    cur = text
    for _ in range(2):
        try:
            cand = _ask(model, src_text, src_lang, cur, lang, slot, budget, glossary)
        except Exception:
            break
        if not cand or units(cand) >= units(best or text):
            break
        best = cur = cand
        if units(cand) <= budget * SOFT_SPEED:
            break
        budget = max(2, int(budget * 0.85))  # 아직 길면 더 짧게
    return best
