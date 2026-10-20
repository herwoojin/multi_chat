"""목소리 견본 — 원본 영상에서 말소리가 이어지는 10~20초를 고르거나, 사용자가 올린 파일을 쓴다."""
from .media import run_ffmpeg

MIN_LEN, MAX_LEN = 10.0, 20.0
# 낮은 웅웅거림을 걷고 크기를 고르게 맞춰 견본 품질을 높인다
CLEAN = 'highpass=f=70,loudnorm=I=-18:TP=-2'


def pick_span(segments, total):
    """음악·무음 대신 문장이 끊기지 않고 이어지는 구간을 고른다."""
    best = (0.0, 0.0)
    for i, s in enumerate(segments):
        start, end, j = s['start'], s['end'], i
        while j + 1 < len(segments) and segments[j + 1]['start'] - end < 0.8 and end - start < MAX_LEN:
            j += 1
            end = segments[j]['end']
        span = (start, min(end, start + MAX_LEN))
        if span[1] - span[0] >= MIN_LEN:
            return span
        if span[1] - span[0] > best[1] - best[0]:
            best = span
    if best[1] - best[0] >= 3:
        return best
    return (0.0, min(MAX_LEN, total))


def pick_ranges(segments, total):
    start, end = pick_span(segments, total)
    if end - start >= MIN_LEN or not segments:
        return [(start, end)]
    # 10초 넘게 이어지는 말이 없으면 말소리 구간만 이어 붙여 10~20초를 만든다 (사이의 무음·음악은 뺀다)
    ranges, acc = [], 0.0
    for s in segments:
        length = min(s['end'] - s['start'], MAX_LEN - acc)
        if length > 0.3:
            ranges.append((s['start'], s['start'] + length))
            acc += length
        if acc >= MAX_LEN:
            break
    return ranges or [(start, end)]


def make_reference(dst, *, source=None, segments=None, total=0.0, upload=None):
    """24kHz 모노 wav 로 저장하고 (첫 시작 시각, 견본 길이) 를 돌려준다."""
    if upload:
        run_ffmpeg('-i', upload, '-t', 30, '-af', CLEAN, '-ac', 1, '-ar', 24000, dst)  # 앞 30초까지
        return (0.0, 30.0)
    ranges = pick_ranges(segments, total)
    if len(ranges) == 1:
        start, end = ranges[0]
        run_ffmpeg('-ss', f'{start:.3f}', '-i', source, '-t', f'{end - start:.3f}', '-vn', '-af', CLEAN, '-ac', 1, '-ar', 24000, dst)
    else:
        keep = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in ranges)
        run_ffmpeg('-i', source, '-vn', '-af', f"aselect='{keep}',asetpts=N/SR/TB,{CLEAN}", '-ac', 1, '-ar', 24000, dst)
    return (ranges[0][0], sum(b - a for a, b in ranges))
