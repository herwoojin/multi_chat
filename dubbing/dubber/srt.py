"""SRT 자막 파일."""


def _ts(seconds):
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def write_srt(path, cues):
    """cues: [{start, end, text}]"""
    lines = []
    for i, c in enumerate(cues, 1):
        lines += [str(i), f"{_ts(c['start'])} --> {_ts(c['end'])}", c['text'].strip(), '']
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
