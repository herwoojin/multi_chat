"""음성 인식 — Whisper large-v3-turbo (로컬).
Apple Silicon 은 MLX 판(빠름), 그 밖(Colab GPU·Windows·Intel)은 openai-whisper(PyTorch)를 쓴다.
두 라이브러리는 같은 transcribe() 결과 모양을 돌려준다. DUB_STT=mlx|openai 로 강제할 수 있다.
"""
import gc
import os
import platform

MODEL = 'mlx-community/whisper-large-v3-turbo'  # MLX 판 모델
OPENAI_MODEL = 'turbo'                          # openai-whisper 판 (같은 large-v3-turbo)
_openai = None


def backend():
    forced = os.environ.get('DUB_STT')
    if forced in ('mlx', 'openai'):
        return forced
    return 'mlx' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else 'openai'


def _transcribe(path, language, **kw):
    if backend() == 'mlx':
        import mlx_whisper
        return mlx_whisper.transcribe(str(path), path_or_hf_repo=MODEL, language=language, verbose=None, **kw)
    global _openai
    import torch
    import whisper
    gpu = torch.cuda.is_available()
    if _openai is None:
        _openai = whisper.load_model(OPENAI_MODEL, device='cuda' if gpu else 'cpu')
    return _openai.transcribe(str(path), language=language, fp16=gpu, verbose=None, **kw)


def transcribe(wav_path, language=None):
    """@returns (감지된 언어, [{start, end, text}])"""
    # 앞 문장에 끌려가 같은 말을 되풀이하는 환각을 줄인다
    result = _transcribe(wav_path, language, condition_on_previous_text=False)
    segments = []
    for s in result.get('segments', []):
        text = (s.get('text') or '').strip()
        if not text:
            continue
        # 무음·음악 구간 환각("시청해 주셔서 감사합니다" 등)과 반복 문장을 걸러낸다
        if s.get('no_speech_prob', 0) > 0.6 and s.get('avg_logprob', 0) < -1.0:
            continue
        if s.get('compression_ratio', 0) > 2.4:
            continue
        segments.append({'start': round(float(s['start']), 3), 'end': round(float(s['end']), 3), 'text': text})
    free_cache()
    return result.get('language'), segments


def transcribe_text(path, language):
    """짧은 소리를 글자로만 (합성 결과 재확인용)."""
    return _transcribe(path, language, condition_on_previous_text=False).get('text', '')


def free_cache():
    # 더빙 모델과 메모리를 나눠 쓰므로 바로 비운다
    if backend() == 'mlx':
        try:
            import mlx.core as mx
            mx.clear_cache()
        except Exception:
            pass
    gc.collect()
