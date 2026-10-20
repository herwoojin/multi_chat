"""명령줄로 더빙하기.

  .venv/bin/python -m dubber "https://youtu.be/..." --i-have-permission
  .venv/bin/python -m dubber "https://youtu.be/..." --langs en,ja --minutes 2 --voice my_voice.m4a --i-have-permission
  .venv/bin/python -m dubber ~/Movies/my_video.mp4 --i-have-permission      # 내 영상 파일
"""
import argparse
import threading
import time
from pathlib import Path

from .langs import DEFAULT_TARGETS, LANGS
from .pipeline import Job, Options


def main():
    ap = argparse.ArgumentParser(prog='dubber', description='유튜브 영상을 원래 목소리로 여러 언어 더빙')
    ap.add_argument('url', help='유튜브 링크 또는 내 영상·음성 파일 경로')
    ap.add_argument('--langs', default=','.join(DEFAULT_TARGETS), help=f'쉼표로 구분 ({", ".join(LANGS)})')
    ap.add_argument('--minutes', type=float, help='앞부분 몇 분만')
    ap.add_argument('--voice', help='목소리 견본 파일 (없으면 영상 속 목소리)')
    ap.add_argument('--source', help='원래 언어 (없으면 자동 감지)')
    ap.add_argument('--exaggeration', type=float, default=0.5)
    ap.add_argument('--cfg', type=float, default=0.5)
    ap.add_argument('--i-have-permission', action='store_true', help='본인 또는 허락받은 목소리임을 확인')
    a = ap.parse_args()
    if not a.i_have_permission:
        ap.error('본인 목소리이거나 허락받은 목소리일 때만 쓸 수 있어요. 확인했다면 --i-have-permission 을 붙이세요.')

    opts = Options(url=a.url, targets=[t for t in a.langs.split(',') if t in LANGS], source_lang=a.source,
                   max_minutes=a.minutes, voice_file=a.voice, exaggeration=a.exaggeration, cfg_weight=a.cfg)
    job = Job(Path(__file__).resolve().parent.parent / 'jobs', opts)
    t = threading.Thread(target=job.run)
    t.start()
    last = ''
    while t.is_alive():
        s = job.state
        line = f"[{s['progress'] * 100:5.1f}%] {s['stageLabel']} {s['message']}"
        if line != last:
            print(line, flush=True)
            last = line
        time.sleep(1)
    s = job.state
    if s['status'] != 'done':
        raise SystemExit(f"✖ {s['status']}: {s.get('error') or ''} (로그: {job.dir / 'error.log'})")
    print(f"\n✅ 완료 → {job.dir / s['zip']['path']}")
    for f in s['files']:
        print(f"   {f['label']:<20} {job.dir / f['path']}")


if __name__ == '__main__':
    main()
