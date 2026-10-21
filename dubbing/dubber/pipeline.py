"""더빙 작업 한 건 — 두 단계로 나뉜다.

  준비   내려받기 → 음성 인식(문장·첫 단어 시각) → 번역 → 길이 맞추기(로컬 AI) → subtitles.json
  (검토  사람이 원문·번역·시각을 고치고, 지우고, 더한다 — 웹 화면. review=False 면 건너뛴다)
  만들기 목소리 견본 → 문장별 합성(바뀐 문장만 새로) → 시간표 맞추기 → 영상·음성·자막·zip

진행 상황은 jobs/<id>/job.json, 자막은 subtitles.json, 마지막으로 놓인 시각·배속은 render.json.
"""
import hashlib
import json
import shutil
import threading
import time
import traceback
import uuid
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

import soundfile as sf

from . import fit, glossary, media, mix, stt, translate, tts, voice
from .langs import DEFAULT_TARGETS, LANGS, gtx_code, iso3, label
from .srt import write_srt

MAX_TOTAL_SECONDS = 60 * 60  # 1시간 넘는 영상은 "앞부분만" 으로 잘라서

# (단계, 화면 이름, 그 단계(준비/만들기) 안에서 차지하는 몫)
PREPARE = [('download', '영상 내려받기', 0.2), ('stt', '음성 인식', 0.35), ('translate', '번역', 0.2), ('fit', '길이 맞추기', 0.25)]
RENDER = [('voice', '목소리 준비', 0.05), ('tts', '목소리 합성', 0.9), ('package', '영상·자막 묶기', 0.05)]
_WEIGHT = {k: w for k, _, w in PREPARE + RENDER}
_LABEL = {k: n for k, n, _ in PREPARE + RENDER}
_BEFORE = {k: sum(w for _, _, w in st[:i]) for st in (PREPARE, RENDER) for i, (k, _, _) in enumerate(st)}


@dataclass
class Options:
    url: str
    targets: list = field(default_factory=lambda: list(DEFAULT_TARGETS))
    source_lang: str | None = None     # None 이면 Whisper 가 감지
    max_minutes: float | None = None   # 앞부분만 (시험·긴 영상)
    voice_file: str | None = None      # 없으면 원본 영상의 목소리를 쓴다
    exaggeration: float = 0.5          # 감정 세기 0.25~1.0
    cfg_weight: float = 0.5            # 낮추면 차분하고 느려진다
    glossary: str = ''                 # 자주 나오는 단어 — 음성 인식·AI 번역 힌트
    review: bool = True                # 자막을 만든 뒤 멈추고 사람이 확인·편집한 다음 영상을 만든다


def safe_name(s, n=60):
    import re
    return re.sub(r'[\\/:*?"<>|\s]+', '_', s).strip('_')[:n] or 'video'


def _sha(*parts):
    return hashlib.sha1('|'.join(map(str, parts)).encode()).hexdigest()[:16]


class Job:
    def __init__(self, root, opts: Options, job_id=None, state=None):
        self.id = job_id or time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:4]
        self.dir = Path(root) / self.id
        self.out = self.dir / 'out'
        self.opts = opts
        self._cancel = threading.Event()
        self._save_lock = threading.Lock()  # 번역은 여러 스레드가 동시에 진행률을 쓴다
        self.state = state or {
            'id': self.id, 'url': opts.url, 'targets': opts.targets, 'status': 'queued', 'phase': 'prepare',
            'stage': None, 'stageLabel': '대기 중', 'progress': 0.0, 'message': '',
            'title': '', 'duration': None, 'sourceLang': None, 'source': None, 'createdAt': time.time(),
            'finishedAt': None, 'files': [], 'zip': None, 'stats': {}, 'error': None, 'hasSubtitles': False,
            'options': asdict(opts),
        }

    @classmethod
    def load(cls, root, job_id):
        """서버가 다시 켜져도 검토 중이던 작업을 이어서 만들 수 있게 디스크에서 되살린다."""
        st = load_state(Path(root) / job_id)
        o = st.get('options', {})
        opts = Options(**{k: o[k] for k in Options.__dataclass_fields__ if k in o})
        return cls(root, opts, job_id, st)

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

    # ── 자막 ──────────────────────────────────────────────
    @property
    def subs_path(self):
        return self.dir / 'subtitles.json'

    def load_subs(self):
        return json.loads(self.subs_path.read_text(encoding='utf-8'))

    def save_subs(self, subs):
        subs['segments'].sort(key=lambda s: s['start'])
        tmp = self.dir / 'subtitles.json.tmp'
        tmp.write_text(json.dumps(subs, ensure_ascii=False, indent=1), encoding='utf-8')
        tmp.replace(self.subs_path)
        self._set(hasSubtitles=True)

    def load_render(self):
        p = self.dir / 'render.json'
        return json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}

    def _slots(self, segments):
        return fit.slots(segments, self.state.get('duration') or (segments[-1]['end'] if segments else 0))

    def retranslate(self, ids):
        """고친 원문을 모든 대상 언어로 다시 번역하고, 너무 길면 로컬 AI 로 줄인다."""
        subs = self.load_subs()
        src = subs['sourceLang']
        segs = sorted(subs['segments'], key=lambda s: s['start'])
        slot = dict(zip((s['id'] for s in segs), self._slots(segs)))
        model = fit.llm_model()
        for seg in segs:
            if seg['id'] not in ids or not seg['text'].strip():
                continue
            for t in subs['targets']:
                tr = translate.translate_one(seg['text'], gtx_code(src), gtx_code(t)) or seg['text']
                if model and fit.too_long(tr, t, slot[seg['id']]):
                    tr = fit.shorten(seg['text'], src, tr, t, slot[seg['id']], self.opts.glossary, model) or tr
                seg['tr'][t] = tr
                seg.setdefault('trFrom', {})[t] = seg['text']
        self.save_subs(subs)
        return subs

    # ── 실행 ──────────────────────────────────────────────
    def run(self, phase='prepare'):
        self._cancel.clear()
        try:
            self._set(status='running', phase=phase, error=None, finishedAt=None)
            if phase == 'prepare':
                self._prepare()
                if self.opts.review:
                    self._set(status='review', stage=None, stageLabel='자막 검토', progress=1.0,
                              message='자막을 확인·수정한 뒤 [영상 만들기]를 눌러 주세요.')
                    return
                self._set(phase='render')
            self._render()
            self._set(status='done', stage=None, stageLabel='완료', progress=1.0, message='', finishedAt=time.time())
        except media.Canceled:
            self._set(status='canceled', stageLabel='취소됨', message='', finishedAt=time.time())
        except Exception as e:  # noqa: BLE001 — 화면에 이유를 보여 주고 로그를 남긴다
            (self.dir / 'error.log').write_text(traceback.format_exc(), encoding='utf-8')
            self._set(status='error', error=str(e) or e.__class__.__name__, finishedAt=time.time())
        finally:
            tts.free_cache()

    def _prepare(self):
        o = self.opts
        canceled = self._cancel.is_set

        # 1) 내려받기 (또는 내 영상 파일)
        max_seconds = o.max_minutes * 60 if o.max_minutes else None
        if Path(o.url).is_file():
            self._stage('download', 0.5, '영상 파일을 준비하는 중…')
            info = media.use_local(o.url, self.dir, max_seconds=max_seconds, max_total_seconds=MAX_TOTAL_SECONDS)
        else:
            self._stage('download', 0, '영상 정보를 확인하는 중…')
            info = media.download(
                o.url, self.dir, max_seconds=max_seconds, max_total_seconds=MAX_TOTAL_SECONDS,
                on_progress=lambda f: self._stage('download', f, '영상 내려받는 중…'), is_canceled=canceled,
            )
        src, total = Path(info['path']), info['duration']
        self._set(title=info['title'], duration=round(total, 2), source=src.name)

        # 2) 음성 인식 — 문장 단위, 첫 단어가 들리는 시각부터
        self._stage('stt', 0.05, '말소리를 글자로 바꾸는 중… (영상 길이에 따라 수십 초~몇 분)')
        audio16 = self.dir / 'audio_16k.wav'
        media.extract_audio(src, audio16, 16000)
        lang, found = stt.transcribe(audio16, o.source_lang)
        audio16.unlink(missing_ok=True)
        if not found:
            raise ValueError('영상에서 말소리를 찾지 못했어요.')
        # 자주 나오는 단어로 받아쓰기 고치기 (재미나이 → 제미나이) — 바꾼 곳은 화면에 보여 준다
        fixes = []
        for s in found:
            s['text'], ch = glossary.fix(s['text'], o.glossary)
            fixes += ch
        self.state['stats']['glossaryFixes'] = [f'{a} → {b}' for a, b in fixes]
        lang = lang or o.source_lang or 'ko'
        targets = [t for t in o.targets if t in LANGS and t != lang]  # 원래 언어와 같은 대상은 건너뛴다
        if not targets:
            raise ValueError('더빙할 언어가 없어요. 원래 언어와 다른 언어를 골라 주세요.')
        self._set(sourceLang=lang, targets=targets)
        segs = [{'id': f's{i + 1}', 'start': s['start'], 'end': s['end'], 'text': s['text'], 'tr': {}, 'trFrom': {}}
                for i, s in enumerate(found)]

        # 3) 번역
        texts = [s['text'] for s in segs]
        for k, t in enumerate(targets):
            out = translate.translate_all(
                texts, gtx_code(lang), gtx_code(t), is_canceled=canceled,
                on_progress=lambda f, k=k, t=t: self._stage('translate', (k + f) / len(targets), f'{label(t)} 번역 중…'),
            )
            for seg, tr in zip(segs, out):
                seg['tr'][t] = tr
                seg['trFrom'][t] = seg['text']

        # 4) 길이 맞추기 — 원래 말한 시간보다 긴 번역만 로컬 AI 로 줄인다
        self._stage('fit', 0, '번역 길이를 원래 시간과 비교하는 중…')
        slots = fit.slots(segs, total)
        todo = [(i, t) for t in targets for i, s in enumerate(segs) if fit.too_long(s['tr'][t], t, slots[i])]
        model = fit.llm_model() if todo else None
        done = 0
        if model:
            for n, (i, t) in enumerate(todo):
                self._stage('fit', n / len(todo), f'{label(t)} {i + 1}번 문장을 시간에 맞게 줄이는 중 ({n + 1}/{len(todo)}) · {model}')
                new = fit.shorten(segs[i]['text'], lang, segs[i]['tr'][t], t, slots[i], o.glossary, model)
                if new:
                    segs[i]['tr'][t] = new
                    segs[i].setdefault('shortened', {})[t] = True
                    done += 1
            fit.unload(model)
        self.state['stats']['fit'] = {
            'model': model, 'tooLong': len(todo), 'shortened': done,
            'note': '' if model or not todo else '로컬 AI(Ollama)가 없어 길이 맞추기를 건너뛰었어요 — 편집 화면에서 줄여 주세요',
        }
        self.save_subs({'sourceLang': lang, 'targets': targets, 'segments': segs})

    def _render(self):
        o = self.opts
        subs = self.load_subs()
        lang, targets = subs['sourceLang'], subs['targets']
        segs = sorted((s for s in subs['segments'] if s['text'].strip() or any(v.strip() for v in s['tr'].values())),
                      key=lambda s: s['start'])
        if not segs:
            raise ValueError('자막이 비어 있어요. 문장을 하나 이상 남겨 주세요.')
        src, total = self.dir / self.state['source'], float(self.state['duration'])

        # 지난 결과를 비우고 새로 만든다 (합성한 문장은 clips/ 에 남아 다시 쓴다)
        shutil.rmtree(self.out, ignore_errors=True)
        self.out.mkdir(parents=True)
        self._set(files=[], zip=None)

        # 1) 목소리 견본 + 더빙 모델
        self._stage('voice', 0.1, '목소리 견본을 고르는 중…')
        ref = self.dir / 'voice_ref.wav'
        if not ref.exists():
            span = voice.make_reference(ref, source=src, segments=segs, total=total, upload=o.voice_file)
            self.state['stats']['voiceRef'] = {'start': round(span[0], 2), 'length': round(span[1], 2), 'from': 'upload' if o.voice_file else 'source'}
        self._stage('voice', 0.4, '더빙 모델을 불러오는 중… (처음 한 번은 내려받느라 몇 분 걸려요)')
        v = tts.Voice(ref, exaggeration=o.exaggeration, cfg_weight=o.cfg_weight)
        vkey = _sha(hashlib.sha1(ref.read_bytes()).hexdigest(), o.exaggeration, o.cfg_weight)

        # 2) 문장별 합성 — 같은 목소리·같은 문장은 지난번 것을 다시 쓴다 (고친 문장만 새로)
        clip_path = lambda t, text: self.dir / 'clips' / t / f'{_sha(vkey, t, text)}.wav'  # noqa: E731
        jobs = [(t, s) for t in targets for s in segs if s['tr'].get(t, '').strip()]
        new = [(t, s) for t, s in jobs if not clip_path(t, s['tr'][t].strip()).exists()]
        done, started, placed_all, used = 0, time.time(), {}, set()
        for t in targets:
            clips, scores, retried = [], [], 0
            for seg in segs:
                text = seg['tr'].get(t, '').strip()
                if not text:
                    clips.append(None)
                    continue
                p = clip_path(t, text)
                used.add(p)
                if p.exists():
                    clip, _ = sf.read(p, dtype='float32')
                else:
                    eta = ''
                    if done:
                        left = (time.time() - started) / done * (len(new) - done)
                        eta = f' · 남은 시간 약 {left / 60:.0f}분' if left >= 90 else f' · 남은 시간 약 {left:.0f}초'
                    self._stage('tts', done / max(1, len(new)), f'{label(t)} {segs.index(seg) + 1}/{len(segs)} 문장{eta}')
                    clip, score, tries = v.say_checked(text, t, expected=fit.estimate(text, t))
                    p.parent.mkdir(parents=True, exist_ok=True)
                    sf.write(p, clip, v.sr)
                    scores.append(score)
                    retried += tries > 1
                    done += 1
                    fit.learn(t, text, len(mix.trim(clip, v.sr)) / v.sr)  # 실제 말 속도를 배워 다음 어림을 고친다
                clips.append(clip)
            self._stage('tts', done / max(1, len(new)), f'{label(t)} 트랙을 맞추는 중…')
            track, placed, st = mix.build_track(segs, clips, v.sr, total)
            st.update(retried=retried, newClips=len(scores),
                      avgMatch=round(sum(scores) / len(scores), 3) if scores else None)
            self.state['stats'][t] = st
            placed_all[t] = {s['id']: p for s, p in zip(segs, placed) if p}

            d = self.out / t
            d.mkdir(exist_ok=True)
            wav = self.dir / f'dub_{t}.wav'
            sf.write(wav, track, v.sr)
            media.to_mp3(wav, d / f'dub_{t}.mp3')
            cues = [{'start': p['start'], 'end': max(p['end'], p['start'] + 0.5), 'text': s['tr'][t]}
                    for s, p in zip(segs, placed) if p]
            write_srt(d / f'subtitles_{t}.srt', cues)
            if media.has_video(src):  # 음성 파일만 넣었으면 영상은 건너뛴다
                media.mux_video(src, wav, d / f'subtitles_{t}.srt', d / f'video_{t}.mp4', iso3(t), total)
                self._add_file(t, 'video', d / f'video_{t}.mp4', f'{label(t)} 더빙 영상')
            wav.unlink(missing_ok=True)
            self._add_file(t, 'audio', d / f'dub_{t}.mp3', f'{label(t)} 더빙 음성')
            self._add_file(t, 'srt', d / f'subtitles_{t}.srt', f'{label(t)} 자막')
            tts.free_cache()
        (self.dir / 'render.json').write_text(json.dumps(placed_all, ensure_ascii=False), encoding='utf-8')
        for p in (self.dir / 'clips').rglob('*.wav'):  # 더 이상 안 쓰는 옛 문장은 지워 디스크를 아낀다
            if p not in used:
                p.unlink(missing_ok=True)

        # 3) 원문 자막 · 안내문 · 전체 zip
        self._stage('package', 0.3, '전체 파일을 묶는 중…')
        write_srt(self.out / f'subtitles_{lang}_original.srt', [s for s in segs if s['text'].strip()])
        self._add_file(lang, 'srt', self.out / f'subtitles_{lang}_original.srt', f'{label(lang)} 원문 자막')
        (self.out / 'transcript.json').write_text(json.dumps(
            {'title': self.state['title'], 'url': self.state['url'], 'sourceLang': lang, 'segments': segs},
            ensure_ascii=False, indent=1), encoding='utf-8')
        (self.out / 'README.txt').write_text(self._readme(lang, targets), encoding='utf-8')
        zpath = self.dir / f'{safe_name(self.state["title"])}_dubbed.zip'
        with zipfile.ZipFile(zpath, 'w') as z:
            for p in sorted(self.out.rglob('*')):
                if p.is_file():
                    # 영상·음성은 이미 압축돼 있어 그대로 담는다
                    method = zipfile.ZIP_STORED if p.suffix in ('.mp4', '.mp3') else zipfile.ZIP_DEFLATED
                    z.write(p, p.relative_to(self.out), compress_type=method)
        self._set(zip={'path': str(zpath.relative_to(self.dir)), 'size': zpath.stat().st_size, 'label': '전체 zip'})

    def _readme(self, lang, targets):
        lines = [
            f'제목: {self.state["title"]}',
            f'원본: {self.state["url"]}',
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
