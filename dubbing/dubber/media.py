"""yt-dlp 다운로드와 ffmpeg 처리."""
import subprocess
from pathlib import Path

import yt_dlp


class Canceled(Exception):
    pass


def run_ffmpeg(*args):
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *map(str, args)], check=True)


def probe_duration(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out or 0)


def download(url, job_dir, max_seconds=None, max_total_seconds=None, on_progress=None, is_canceled=lambda: False):
    """720p 이하 mp4 로 받는다. max_seconds 가 있으면 앞부분만 받는다 (시험용·긴 영상)."""
    job_dir = Path(job_dir)

    def hook(d):
        if is_canceled():
            raise Canceled()
        if d.get('status') == 'downloading' and on_progress:
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            if total:
                on_progress(min(1.0, d.get('downloaded_bytes', 0) / total))

    opts = {
        'format': 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b',
        'merge_output_format': 'mp4',
        'outtmpl': str(job_dir / 'source.%(ext)s'),
        'noplaylist': True,
        'quiet': True,
        'noprogress': True,
        'no_warnings': True,
        'progress_hooks': [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info.get('_type') == 'playlist':
            raise ValueError('재생목록이 아니라 영상 하나의 링크를 넣어 주세요.')
        if info.get('is_live'):
            raise ValueError('라이브 방송은 더빙할 수 없어요.')
        duration = float(info.get('duration') or 0)
        if max_seconds and duration > max_seconds:
            ydl.params['download_ranges'] = yt_dlp.utils.download_range_func(None, [(0, max_seconds)])
            ydl.params['force_keyframes_at_cuts'] = True
        elif max_total_seconds and duration > max_total_seconds:
            raise ValueError(f'영상이 {duration / 60:.0f}분이라 너무 길어요. "앞부분만" 옵션으로 {max_total_seconds // 60:.0f}분 이하로 잘라 주세요.')
        ydl.process_ie_result(info, download=True)

    src = next((p for p in job_dir.glob('source.*') if p.suffix in ('.mp4', '.mkv', '.webm')), None)
    if not src:
        raise RuntimeError('영상을 내려받지 못했어요.')
    return {
        'path': src,
        'title': info.get('title') or 'video',
        'uploader': info.get('uploader') or '',
        'url': info.get('webpage_url') or url,
        'duration': probe_duration(src),
    }


def extract_audio(src, dst, sample_rate, start=None, length=None):
    """모노 wav 로 뽑는다. start/length 를 주면 그 구간만."""
    args = []
    if start is not None:
        args += ['-ss', f'{start:.3f}']
    args += ['-i', src]
    if length is not None:
        args += ['-t', f'{length:.3f}']
    run_ffmpeg(*args, '-vn', '-ac', 1, '-ar', sample_rate, dst)


def to_mp3(wav, mp3):
    run_ffmpeg('-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', mp3)


def mux_video(video, dub_wav, srt, out, lang_iso3, duration):
    """원본 영상 + 더빙 음성 + 자막(켜고 끌 수 있는 트랙)으로 mp4 를 만든다."""
    run_ffmpeg(
        '-i', video, '-i', dub_wav, '-i', srt,
        '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-c:s', 'mov_text',
        '-metadata:s:a:0', f'language={lang_iso3}', '-metadata:s:s:0', f'language={lang_iso3}',
        '-t', f'{duration:.3f}', '-movflags', '+faststart', out,
    )


def atempo(src_wav, dst_wav, speed):
    """음높이는 그대로 두고 빠르게 만든다 (ffmpeg atempo 는 한 번에 0.5~2.0배)."""
    run_ffmpeg('-i', src_wav, '-filter:a', f'atempo={speed:.4f}', dst_wav)
