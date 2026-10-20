"""원래 시간표에 더빙 문장을 놓아 한 줄짜리 음성 트랙을 만든다."""
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from .media import atempo

MAX_SPEED = 1.4  # 이보다 빠르면 알아듣기 어렵다 — 그래도 넘치면 다음 문장을 조금 미룬다
GAP = 0.06       # 문장 사이 최소 숨 고르기(초)


def _stretch(clip, sr, speed):
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'in.wav', Path(tmp) / 'out.wav'
        sf.write(src, clip, sr)
        atempo(src, dst, speed)
        out, _ = sf.read(dst, dtype='float32')
    return out


def build_track(segments, clips, sr, total):
    """
    문장 i 는 원래 시작 시각에 놓는다. 다음 문장 시작 전까지 못 끝나면 최대 1.4배까지 빠르게 하고,
    그래도 길면 다음 문장을 뒤로 민다(쉬는 구간에서 다시 원래 시각을 따라잡는다).
    @returns (track, placements[(start, end)], stats)
    """
    out = np.zeros(int((total + 5) * sr), np.float32)
    placements = []
    cursor = 0.0
    sped = 0
    max_drift = 0.0
    for i, (seg, clip) in enumerate(zip(segments, clips)):
        if clip is None or not len(clip):
            placements.append((seg['start'], seg['end']))
            continue
        clip, _ = librosa.effects.trim(clip, top_db=40)  # 앞뒤 무음을 걷어 시간을 아낀다
        start = max(seg['start'], cursor)
        nxt = segments[i + 1]['start'] if i + 1 < len(segments) else max(total, seg['end'])
        room = max(nxt - start - GAP, 0.25)
        dur = len(clip) / sr
        if dur > room:
            clip = _stretch(clip, sr, min(dur / room, MAX_SPEED))
            dur = len(clip) / sr
            sped += 1
        a = int(start * sr)
        if a + len(clip) > len(out):
            out = np.pad(out, (0, a + len(clip) - len(out) + sr))
        out[a:a + len(clip)] += clip
        placements.append((start, start + dur))
        cursor = start + dur + GAP
        max_drift = max(max_drift, start - seg['start'])

    out = out[: int(max(total, cursor) * sr)]
    peak = float(np.abs(out).max()) if len(out) else 0.0
    if peak > 0.98:
        out *= 0.98 / peak
    return out, placements, {'spedUp': sped, 'maxDelay': round(max_drift, 2)}
