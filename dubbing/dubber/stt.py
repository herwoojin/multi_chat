"""음성 인식 — Whisper (로컬).
Apple Silicon 은 MLX 판(빠름), 그 밖(Colab GPU·Windows·Intel)은 openai-whisper(PyTorch)를 쓴다.
두 라이브러리는 같은 transcribe() 결과 모양을 돌려준다. DUB_STT=mlx|openai 로 강제할 수 있다.

- 받아쓰기는 large-v3: turbo 보다 숫자·비슷한 말에 강하다 (실측: "지하 U층" → "지하 1층").
- 단어마다 시각을 받아 문장 경계로 다시 나눈다. Whisper 문장은 앞 문장이 끝난 시각에 시작하는 경우가 많아,
  그대로 쓰면 더빙이 원래 말보다 먼저 나온다 — 첫 단어가 실제로 들리는 시각을 시작으로 삼는다.
"""
import gc
import os
import platform
import re

MODEL = 'mlx-community/whisper-large-v3-mlx'          # 받아쓰기
CHECK_MODEL = 'mlx-community/whisper-large-v3-turbo'  # 합성 결과 재확인 — 빠른 판으로 충분
OPENAI_MODEL = 'large-v3'                             # openai-whisper 는 한 모델로 둘 다
_openai = None

SENTENCE_END = re.compile(r'[.?!。？！…]["\')\]」』]*$')
MIN_SENTENCE = 0.8   # 이보다 짧은 문장("네.")은 다음 문장과 합친다
PAUSE_SPLIT = 0.7    # 이만큼 쉬면 문장부호가 없어도 나눈다
LONG_SPLIT = 12.0    # 이보다 길면 쉼표에서라도 나눈다


def backend():
    forced = os.environ.get('DUB_STT')
    if forced in ('mlx', 'openai'):
        return forced
    return 'mlx' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else 'openai'


def _transcribe(path, language, model=None, **kw):
    if backend() == 'mlx':
        import mlx_whisper
        return mlx_whisper.transcribe(str(path), path_or_hf_repo=model or MODEL, language=language, verbose=None, **kw)
    global _openai
    import torch
    import whisper
    gpu = torch.cuda.is_available()
    if _openai is None:
        _openai = whisper.load_model(OPENAI_MODEL, device='cuda' if gpu else 'cpu')
    return _openai.transcribe(str(path), language=language, fp16=gpu, verbose=None, **kw)


def _kept(s):
    """무음·음악 구간 환각("시청해 주셔서 감사합니다" 등)과 반복 문장을 걸러낸다."""
    if not (s.get('text') or '').strip():
        return False
    if s.get('no_speech_prob', 0) > 0.6 and s.get('avg_logprob', 0) < -1.0:
        return False
    return s.get('compression_ratio', 0) <= 2.4


def _sentences(segments):
    words = [(float(w['start']), float(w['end']), w['word'])
             for s in segments for w in (s.get('words') or []) if w.get('word', '').strip()]
    if not words:  # 단어 시각이 없으면 Whisper 문장을 그대로
        return [{'start': round(float(s['start']), 3), 'end': round(float(s['end']), 3), 'text': s['text'].strip()} for s in segments]
    out, cur = [], []
    for i, (a, b, w) in enumerate(words):
        cur.append((a, b, w))
        nxt = words[i + 1] if i + 1 < len(words) else None
        dur = b - cur[0][0]
        token = w.strip()
        if (nxt is None
                or (SENTENCE_END.search(token) and dur >= MIN_SENTENCE)
                or nxt[0] - b >= PAUSE_SPLIT
                or (dur >= LONG_SPLIT and token.endswith(','))):
            text = ''.join(x[2] for x in cur).strip()
            if text:
                out.append({'start': round(cur[0][0], 3), 'end': round(cur[-1][1], 3), 'text': text})
            cur = []
    return out


def transcribe(wav_path, language=None):
    """@returns (감지된 언어, [{start, end, text}]) — 문장 단위, 첫 단어가 들리는 시각부터.
    용어 힌트(initial_prompt)는 주지 않는다 — 실측에서 다른 곳('지하 2층')을 틀어지게 해서, 받아쓴 뒤 glossary.fix 로 고친다.
    """
    # 앞 문장에 끌려가는 반복 환각을 줄인다
    result = _transcribe(wav_path, language, condition_on_previous_text=False, word_timestamps=True)
    segments = _sentences([s for s in result.get('segments', []) if _kept(s)])
    free_cache()
    return result.get('language'), segments


def transcribe_text(path, language):
    """짧은 소리를 글자로만 (합성 결과 재확인용)."""
    return _transcribe(path, language, model=CHECK_MODEL, condition_on_previous_text=False).get('text', '')


def free_cache():
    # 더빙 모델과 메모리를 나눠 쓰므로 바로 비운다
    if backend() == 'mlx':
        try:
            import mlx.core as mx
            mx.clear_cache()
        except Exception:
            pass
    gc.collect()
