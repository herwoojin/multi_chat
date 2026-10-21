"""목소리 합성 — Chatterbox Multilingual (로컬 · MIT). 10~20초짜리 목소리 견본으로 그 목소리를 흉내 낸다.
일본어 한자→히라가나(pykakasi)·중국어 처리는 Chatterbox 가 안에서 해 준다.
"""
import os

os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')  # MPS 에 없는 연산은 CPU 로 돌린다

import re
import threading

import numpy as np

_lock = threading.Lock()
_model = None
MAX_CHARS = 280  # 이보다 긴 문장은 쪼개 합성한다 (한 번에 만들 수 있는 길이 한도)


def device():
    import torch
    if torch.cuda.is_available():
        return 'cuda'
    if torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def _fix_hook_leak():
    """
    Chatterbox 0.1.7 버그 보정: 문장을 만들 때마다 AlignmentStreamAnalyzer 가 attention 층 3곳에
    forward hook 을 새로 달고 떼지 않는다. 문장이 쌓일수록 매 토큰마다 GPU→CPU 복사가 늘어
    긴 작업일수록 점점 느려진다. 새 분석기가 첫 hook 을 달기 전에 이전 문장의 hook 을 뗀다.
    (그 층들에는 Chatterbox 만 hook 을 단다)
    """
    from chatterbox.models.t3.inference import alignment_stream_analyzer as asa

    cls = asa.AlignmentStreamAnalyzer
    if getattr(cls, '_maltong_hook_fix', False):
        return
    original = cls._add_attention_spy

    def spy(self, tfmr, buffer_idx, layer_idx, head_idx):
        if buffer_idx == 0:
            for li, _ in asa.LLAMA_ALIGNED_HEADS:
                tfmr.layers[li].self_attn._forward_hooks.clear()
        return original(self, tfmr, buffer_idx, layer_idx, head_idx)

    cls._add_attention_spy = spy

    # 같은 버전의 또 다른 버그: 글자 토큰이 5개 이하인 아주 짧은 문장("Is it B1?")이 다 읽힌 뒤
    # 반복 검사가 빈 구간에 max() 를 해 IndexError 로 멈춘다. 문장이 끝난 상태이므로 원래 코드처럼 끝(EOS)을 낸다.
    original_step = cls.step

    def step(self, logits, next_token=None):
        try:
            return original_step(self, logits, next_token=next_token)
        except IndexError:
            if not getattr(self, 'complete', False):
                raise
            import torch
            forced = torch.full_like(logits, -2 ** 15)
            forced[..., self.eos_idx] = 2 ** 15
            return forced

    cls.step = step
    cls._maltong_hook_fix = True


def load():
    """모델은 프로세스에 한 번만 올린다 (약 3GB, 처음엔 내려받기)."""
    global _model
    with _lock:
        if _model is None:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            _fix_hook_leak()
            _model = ChatterboxMultilingualTTS.from_pretrained(device=device())
    return _model


def free_cache():
    import torch
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.empty_cache()


def _split(text):
    if len(text) <= MAX_CHARS:
        return [text]
    parts, cur = [], ''
    for piece in re.split(r'(?<=[.!?。！？])\s*', text):
        if cur and len(cur) + len(piece) > MAX_CHARS:
            parts.append(cur)
            cur = ''
        cur = f'{cur} {piece}'.strip()
    if cur:
        parts.append(cur)
    # 문장부호 없이 긴 글은 글자 수로 자른다
    return [p[i:i + MAX_CHARS] for p in parts for i in range(0, len(p), MAX_CHARS)]


class Voice:
    def __init__(self, ref_wav, exaggeration=0.5, cfg_weight=0.5):
        self.model = load()
        self.exaggeration = exaggeration
        self.cfg_weight = cfg_weight
        # 견본 목소리 특징을 한 번만 뽑아 두고 문장마다 재사용한다
        self.model.prepare_conditionals(str(ref_wav), exaggeration=exaggeration)

    @property
    def sr(self):
        return self.model.sr

    def say(self, text, lang):
        """@returns float32 mono numpy (sr = self.sr)"""
        chunks = []
        for part in _split(text.strip()):
            wav = self.model.generate(part, language_id=lang, exaggeration=self.exaggeration, cfg_weight=self.cfg_weight)
            chunks.append(wav.squeeze(0).detach().cpu().numpy().astype(np.float32))
        return np.concatenate(chunks) if chunks else np.zeros(0, np.float32)

    def say_checked(self, text, lang, expected=None):
        """
        Chatterbox 는 가끔 문장 앞뒤에 알아들을 수 없는 말을 덧붙이고(무작위), 가끔 아주 느리게 읽는다
        (실측: 중국어 7글자에 3.8초). 만든 소리를 Whisper 로 다시 받아써 원래 문장과 비교하고, 길이가
        예상(expected초)보다 한참 길면 다시 만든다 — 내용이 맞는 것 중 가장 짧은 것을 쓴다.
        @returns (wav, 닮은 정도 0~1, 시도 횟수)
        """
        from .mix import trim
        limit = expected * SLOW_FACTOR + 0.5 if expected else None
        good, any_ = [], []
        tries = 0
        for tries in range(1, MAX_TRIES + 1):
            wav = self.say(text, lang)
            got = heard(wav, self.sr, lang)
            score = similarity(text, got)
            dur = len(trim(wav, self.sr)) / self.sr
            any_.append((wav, score, dur))
            if not needs_retry(text, got, score):
                good.append((wav, score, dur))
                if limit is None or dur <= limit:
                    break
        if good:
            wav, score, _ = min(good, key=lambda c: c[2])  # 내용이 맞는 것 중 가장 짧은 것
        else:
            wav, score, _ = max(any_, key=lambda c: c[1])  # 다 어긋나면 가장 닮은 것
        return wav, round(score, 3), tries


SLOW_FACTOR = 1.6  # 예상보다 이만큼 + 0.5초 넘게 길면 너무 느리게 읽은 것
MAX_TRIES = 3
GOOD_ENOUGH = 0.8


def _normalize(s):
    return re.sub(r'[\W_]+', '', s.lower())


def similarity(expected, got):
    """문장부호·공백을 뺀 글자열의 닮은 정도 (0~1). 덧붙은 말이 길수록 낮아진다."""
    import difflib
    a, b = _normalize(expected), _normalize(got)
    return difflib.SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def needs_retry(expected, got, score):
    """
    덧붙은 말(받아쓴 글이 눈에 띄게 길다)이나 엉뚱한 말(거의 안 닮음)일 때만 다시 만든다.
    숫자 표기 차이(eins↔1, 十一↔11)처럼 소리는 맞는데 글자만 다른 경우는 다시 만들지 않는다.
    """
    if score >= GOOD_ENOUGH:
        return False
    e, g = _normalize(expected), _normalize(got)
    return len(g) > len(e) * 1.3 + 3 or score < 0.5


def heard(wav, sr, lang):
    """만든 소리를 Whisper(로컬)로 다시 받아쓴다."""
    import tempfile

    import soundfile as sf

    from .stt import transcribe_text
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        sf.write(f.name, wav, sr)
        return transcribe_text(f.name, lang)
