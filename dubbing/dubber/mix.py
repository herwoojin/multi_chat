"""원래 시간표에 더빙 문장을 놓아 한 줄짜리 음성 트랙을 만든다."""
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from .media import atempo

MAX_SPEED = 1.2  # 이보다 빠르면 부자연스럽다 (1.4배는 "너무 빠르다"는 의견) — 넘치면 다음 문장을 조금 미룬다
LEAD = 0.25      # 자리가 모자라면 앞 문장이 끝난 뒤 쉼 안에서 이만큼 일찍 시작해도 된다
GAP = 0.06       # 문장 사이 최소 숨 고르기(초)


def _stretch(clip, sr, speed):
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / 'in.wav', Path(tmp) / 'out.wav'
        sf.write(src, clip, sr)
        atempo(src, dst, speed)
        out, _ = sf.read(dst, dtype='float32')
    return out


MAX_PAUSE = 0.25  # 문장 안의 쉼은 이만큼까지만 (Chatterbox 는 가끔 문장 중간에 1초 넘게 쉰다)


def trim(clip, sr=24000):
    """
    앞뒤 무음을 걷고 문장 안의 긴 쉼을 0.25초로 줄인다 — 배속 없이 길이를 줄이는 가장 자연스러운 방법.
    (실측: 중국어 12글자가 쉼 때문에 7.2초) 말 속도 학습에도 이 길이를 쓴다.
    """
    if clip is None or not len(clip):
        return clip
    spans = librosa.effects.split(clip, top_db=40)
    if not len(spans):
        return clip
    keep = int(MAX_PAUSE * sr)
    parts = [clip[spans[0][0]:spans[0][1]]]
    for (_, prev_end), (a, b) in zip(spans[:-1], spans[1:]):
        gap = a - prev_end
        if gap > keep:  # 긴 쉼은 앞뒤를 조금씩 남기고 가운데를 덜어 낸다
            parts.append(clip[prev_end:prev_end + keep // 2])
            parts.append(clip[a - keep // 2:a])
        else:
            parts.append(clip[prev_end:a])
        parts.append(clip[a:b])
    return np.concatenate(parts)


def build_track(segments, clips, sr, total):
    """
    문장 i 는 첫 단어가 들리는 원래 시각에 놓는다. 다음 문장 전까지 못 끝나면
    ① 앞 쉼 안에서 최대 0.25초 일찍 시작하고 ② 최대 1.2배까지 빠르게 하고
    ③ 그래도 길면 다음 문장을 뒤로 민다(쉬는 구간에서 다시 원래 시각을 따라잡는다).
    @returns (track, placements[{start, end, speed, delay}], stats)
    """
    out = np.zeros(int((total + 5) * sr), np.float32)
    placements = []
    cursor = 0.0
    sped = 0
    max_delay = 0.0
    for i, (seg, clip) in enumerate(zip(segments, clips)):
        if clip is None or not len(clip):
            placements.append(None)
            continue
        clip = trim(clip, sr)
        nxt = segments[i + 1]['start'] if i + 1 < len(segments) else max(total, seg['end'])
        dur = len(clip) / sr
        start = max(seg['start'], cursor)
        if start + dur > nxt - GAP:
            start = max(cursor, seg['start'] - LEAD)
        room = max(nxt - start - GAP, 0.25)
        speed = 1.0
        if dur > room:
            speed = min(dur / room, MAX_SPEED)
            clip = _stretch(clip, sr, speed)
            dur = len(clip) / sr
            sped += 1
        a = int(start * sr)
        if a + len(clip) > len(out):
            out = np.pad(out, (0, a + len(clip) - len(out) + sr))
        out[a:a + len(clip)] += clip
        delay = max(0.0, start - seg['start'])
        placements.append({'start': round(start, 3), 'end': round(start + dur, 3), 'speed': round(speed, 2), 'delay': round(delay, 2)})
        cursor = start + dur + GAP
        max_delay = max(max_delay, delay)

    out = out[: int(max(total, cursor) * sr)]
    peak = float(np.abs(out).max()) if len(out) else 0.0
    if peak > 0.98:
        out *= 0.98 / peak
    return out, placements, {'spedUp': sped, 'maxDelay': round(max_delay, 2)}
