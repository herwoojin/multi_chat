"""더빙 작업 한 건: 내려받기 → 음성 인식 → 번역 → 목소리 견본 → 목소리 합성 → 영상·자막·zip.
진행 상황을 jobs/<id>/job.json 에 계속 써서 웹 화면이 읽어 간다.
"""
import json
import re
import threading
import time
import traceback
import uuid
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

import soundfile as sf

from . import media, mix, stt, translate, tts, voice
from .langs import DEFAULT_TARGETS, LANGS, gtx_code, iso3, label
from .srt import write_srt

MAX_TOTAL_SECONDS = 60 * 60  # 1시간 넘는 영상은 "앞부분만" 으로 잘라서

# (단계, 화면 이름, 전체 진행률에서 차지하는 몫) — 목소리 합성이 대부분의 시간을 쓴다
STAGES = [
    ('download', '영상 내려받기', 0.06),
    ('stt', '음성 인식', 0.10),
    ('translate', '번역', 0.06),
    ('voice', '목소리 준비', 0.04),
    ('tts', '목소리 합성', 0.70),
    ('package', '영상·자막 묶기', 0.04),
]
_WEIGHT = {k: w for k, _, w in STAGES}
_LABEL = {k: n for k, n, _ in STAGES}
_BEFORE = {k: sum(w for kk, _, w in STAGES[:i]) for i, (k, _, _) in enumerate(STAGES)}


@dataclass
class Options:
    url: str
    targets: list = field(default_factory=lambda: list(DEFAULT_TARGETS))
    source_lang: str | None = None     # None 이면 Whisper 가 감지
    max_minutes: float | None = None   # 앞부분만 (시험·긴 영상)
    voice_file: str | None = None      # 없으면 원본 영상의 목소리를 쓴다
    exaggeration: float = 0.5          # 감정 세기 0.25~1.0
    cfg_weight: float = 0.5            # 낮추면 차분하고 느려진다


def safe_name(s, n=60):
    return re.sub(r'[\\/:*?"<>|\s]+', '_', s).strip('_')[:n] or 'video'


class Job:
    def __init__(self, root, opts: Options, job_id=None):
        self.id = job_id or time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:4]
        self.dir = Path(root) / self.id
        self.out = self.dir / 'out'
        self.opts = opts
        self._cancel = threading.Event()
        self._save_lock = threading.Lock()  # 번역은 여러 스레드가 동시에 진행률을 쓴다
        self.state = {
            'id': self.id, 'url': opts.url, 'targets': opts.targets, 'status': 'queued',
            'stage': None, 'stageLabel': '대기 중', 'progress': 0.0, 'message': '',
            'title': '', 'duration': None, 'sourceLang': None, 'createdAt': time.time(),
            'finishedAt': None, 'files': [], 'zip': None, 'preview': [], 'stats': {}, 'error': None,
            'options': {k: v for k, v in asdict(opts).items() if k != 'voice_file'} | {'voice': 'upload' if opts.voice_file else 'source'},
        }

    # ── 상태 ──────────────────────────────────────────────
    def save(self):
        with self._save_lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.dir / 'job.json.tmp'
            tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=1), encoding='utf-8')
            tmp.replace(self.dir / 'job.json')  # 화면이 반쯤 쓴 파일을 읽지 않게

    def _set(self, **kw):
        with self._save_lock:
            self.state.update(kw)
        self.save()

    def _stage(self, key, frac=0.0, message=''):
        if self._cancel.is_set():
            raise media.Canceled()
        self._set(stage=key, stageLabel=_LABEL[key], message=message,
                  progress=round(_BEFORE[key] + _WEIGHT[key] * max(0.0, min(1.0, frac)), 4))

    def cancel(self):
        self._cancel.set()

    def _add_file(self, lang, kind, path, title):
        self.state['files'].append({
            'lang': lang, 'kind': kind, 'label': title,
            'path': str(Path(path).relative_to(self.dir)), 'size': Path(path).stat().st_size,
        })
        self.save()

    # ── 실행 ──────────────────────────────────────────────
    def run(self):
        try:
            self._set(status='running')
            self.out.mkdir(parents=True, exist_ok=True)
            self._run()
            self._set(status='done', stage=None, stageLabel='완료', progress=1.0, message='', finishedAt=time.time())
        except media.Canceled:
            self._set(status='canceled', stageLabel='취소됨', message='', finishedAt=time.time())
        except Exception as e:  # noqa: BLE001 — 화면에 이유를 보여 주고 로그를 남긴다
            (self.dir / 'error.log').write_text(traceback.format_exc(), encoding='utf-8')
            self._set(status='error', error=str(e) or e.__class__.__name__, finishedAt=time.time())
        finally:
            tts.free_cache()

    def _run(self):
        o = self.opts
        canceled = self._cancel.is_set

        # 1) 내려받기
        self._stage('download', 0, '영상 정보를 확인하는 중…')
        info = media.download(
            o.url, self.dir,
            max_seconds=o.max_minutes * 60 if o.max_minutes else None,
            max_total_seconds=MAX_TOTAL_SECONDS,
            on_progress=lambda f: self._stage('download', f, '영상 내려받는 중…'),
            is_canceled=canceled,
        )
        src, total = info['path'], info['duration']
        self._set(title=info['title'], duration=round(total, 2))

        # 2) 음성 인식 (시간 + 문장)
        self._stage('stt', 0.05, '말소리를 글자로 바꾸는 중… (영상 길이에 따라 수십 초~몇 분)')
        audio16 = self.dir / 'audio_16k.wav'
        media.extract_audio(src, audio16, 16000)
        lang, segs = stt.transcribe(audio16, o.source_lang)
        audio16.unlink(missing_ok=True)
        if not segs:
            raise ValueError('영상에서 말소리를 찾지 못했어요.')
        lang = lang or o.source_lang or 'ko'
        targets = [t for t in o.targets if t in LANGS and t != lang]  # 원래 언어와 같은 대상은 건너뛴다
        if not targets:
            raise ValueError('더빙할 언어가 없어요. 원래 언어와 다른 언어를 골라 주세요.')
        self._set(sourceLang=lang, targets=targets)
        write_srt(self.out / f'subtitles_{lang}_original.srt', segs)
        self._add_file(lang, 'srt', self.out / f'subtitles_{lang}_original.srt', f'{label(lang)} 원문 자막')

        # 3) 번역
        texts = [s['text'] for s in segs]
        tr = {}
        for k, t in enumerate(targets):
            tr[t] = translate.translate_all(
                texts, gtx_code(lang), gtx_code(t), is_canceled=canceled,
                on_progress=lambda f, k=k, t=t: self._stage('translate', (k + f) / len(targets), f'{label(t)} 번역 중…'),
            )
        transcript = [{**s, 'tr': {t: tr[t][i] for t in targets}} for i, s in enumerate(segs)]
        (self.out / 'transcript.json').write_text(json.dumps(
            {'title': info['title'], 'url': info['url'], 'sourceLang': lang, 'segments': transcript},
            ensure_ascii=False, indent=1), encoding='utf-8')
        self._set(preview=transcript[:80])

        # 4) 목소리 견본 + 더빙 모델
        self._stage('voice', 0.1, '목소리 견본을 고르는 중…')
        ref = self.dir / 'voice_ref.wav'
        span = voice.make_reference(ref, source=src, segments=segs, total=total, upload=o.voice_file)
        self.state['stats']['voiceRef'] = {'start': round(span[0], 2), 'length': round(span[1], 2), 'from': 'upload' if o.voice_file else 'source'}
        self._stage('voice', 0.4, '더빙 모델을 불러오는 중… (처음 한 번은 내려받느라 몇 분 걸려요)')
        v = tts.Voice(ref, exaggeration=o.exaggeration, cfg_weight=o.cfg_weight)

        # 5) 언어별 목소리 합성 → 시간표에 맞춰 트랙 만들기 → mp3·자막·영상
        units, done = len(targets) * len(segs), 0
        started = time.time()
        for t in targets:
            clips, scores, retried = [], [], 0
            for i, seg in enumerate(segs):
                eta = ''
                if done:
                    left = (time.time() - started) / done * (units - done)
                    eta = f' · 남은 시간 약 {left / 60:.0f}분' if left >= 90 else f' · 남은 시간 약 {left:.0f}초'
                self._stage('tts', done / units, f'{label(t)} {i + 1}/{len(segs)} 문장{eta}')
                clip, score, tries = v.say_checked(tr[t][i], t)
                clips.append(clip)
                scores.append(score)
                retried += tries > 1
                done += 1
            self._stage('tts', done / units, f'{label(t)} 트랙을 맞추는 중…')
            track, placed, st = mix.build_track(segs, clips, v.sr, total)
            # 다시 받아써 본 닮은 정도 — 낮은 문장은 들어 보고 손볼 수 있게 남긴다
            st.update(retried=retried, avgMatch=round(sum(scores) / len(scores), 3),
                      lowMatch=[i for i, s in enumerate(scores) if s < tts.GOOD_ENOUGH])
            self.state['stats'][t] = st
            d = self.out / t
            d.mkdir(exist_ok=True)
            wav = self.dir / f'dub_{t}.wav'
            sf.write(wav, track, v.sr)
            media.to_mp3(wav, d / f'dub_{t}.mp3')
            # 자막은 더빙 음성이 실제로 나오는 시각에 맞춘다
            cues = [{'start': a, 'end': max(b, a + 0.5), 'text': tr[t][i]} for i, (a, b) in enumerate(placed)]
            write_srt(d / f'subtitles_{t}.srt', cues)
            media.mux_video(src, wav, d / f'subtitles_{t}.srt', d / f'video_{t}.mp4', iso3(t), total)
            wav.unlink(missing_ok=True)
            self._add_file(t, 'video', d / f'video_{t}.mp4', f'{label(t)} 더빙 영상')
            self._add_file(t, 'audio', d / f'dub_{t}.mp3', f'{label(t)} 더빙 음성')
            self._add_file(t, 'srt', d / f'subtitles_{t}.srt', f'{label(t)} 자막')
            tts.free_cache()

        # 6) 안내문 + 전체 zip
        self._stage('package', 0.3, '전체 파일을 묶는 중…')
        (self.out / 'README.txt').write_text(self._readme(info, lang, targets), encoding='utf-8')
        zpath = self.dir / f'{safe_name(info["title"])}_dubbed.zip'
        with zipfile.ZipFile(zpath, 'w') as z:
            for p in sorted(self.out.rglob('*')):
                if p.is_file():
                    # 영상·음성은 이미 압축돼 있어 그대로 담는다
                    method = zipfile.ZIP_STORED if p.suffix in ('.mp4', '.mp3') else zipfile.ZIP_DEFLATED
                    z.write(p, p.relative_to(self.out), compress_type=method)
        self._set(zip={'path': str(zpath.relative_to(self.dir)), 'size': zpath.stat().st_size, 'label': '전체 zip'})

    def _readme(self, info, lang, targets):
        lines = [
            f'제목: {info["title"]}',
            f'원본: {info["url"]}',
            f'원래 언어: {label(lang)}',
            f'더빙 언어: {", ".join(label(t) for t in targets)}',
            f'만든 날: {time.strftime("%Y-%m-%d %H:%M")}',
            '',
            '■ 이 음성은 AI(Chatterbox Multilingual)로 만든 합성 음성입니다.',
            '  영상에 쓸 때는 설명란에 "AI 음성"이라고 밝혀 주세요.',
            '  본인 목소리이거나 허락받은 목소리일 때만 쓰고, 원 화자의 동의 없이 배포하지 마세요.',
            '',
            '■ 파일',
            '  <언어>/video_<언어>.mp4      더빙 영상 (자막 트랙 포함 — 플레이어에서 켜고 끌 수 있어요)',
            '  <언어>/dub_<언어>.mp3        더빙 음성만',
            '  <언어>/subtitles_<언어>.srt  번역 자막 (더빙 음성 시각에 맞춤)',
            f'  subtitles_{lang}_original.srt   원문 자막',
            '  transcript.json             문장별 시간·원문·번역',
        ]
        return '\n'.join(lines) + '\n'


def load_state(job_dir):
    p = Path(job_dir) / 'job.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None
