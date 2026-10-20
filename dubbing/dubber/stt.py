"""음성 인식 — Apple Silicon 에서 빠른 MLX 판 Whisper large-v3-turbo (로컬)."""
import gc

MODEL = 'mlx-community/whisper-large-v3-turbo'


def transcribe(wav_path, language=None):
    """@returns (감지된 언어, [{start, end, text}])"""
    import mlx_whisper

    result = mlx_whisper.transcribe(
        str(wav_path),
        path_or_hf_repo=MODEL,
        language=language,
        # 앞 문장에 끌려가 같은 말을 되풀이하는 환각을 줄인다
        condition_on_previous_text=False,
        verbose=None,
    )
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

    # 더빙 모델과 메모리를 나눠 쓰므로 바로 비운다
    try:
        import mlx.core as mx
        mx.clear_cache()
    except Exception:
        pass
    gc.collect()
    return result.get('language'), segments
