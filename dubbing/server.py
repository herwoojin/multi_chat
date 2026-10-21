"""말.통 더빙 — 로컬 웹 서버 (http://127.0.0.1:8790).
더빙은 GPU(MPS)를 오래 쓰므로 한 번에 한 작업씩 줄 세워 처리한다.
작업은 [준비 → 자막 검토 → 만들기] 로 나뉘고, 검토 단계에서 자막을 고치고 지우고 더할 수 있다.
"""
import json
import os
import queue
import shutil
import threading
import time
import uuid
from pathlib import Path

import psutil
import uvicorn
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from dubber import fit
from dubber.langs import DEFAULT_TARGETS, LANGS
from dubber.pipeline import Job, Options, load_state, safe_name

ROOT = Path(__file__).resolve().parent
JOBS = ROOT / 'jobs'
WEB = ROOT / 'web'
PORT = int(os.environ.get('DUB_PORT', '8790'))
STARTED = time.time()
MAX_TEXT = 2000

app = FastAPI(title='말.통 더빙')
live: dict[str, Job] = {}
pending: 'queue.Queue[tuple[Job, str]]' = queue.Queue()


def _worker():
    while True:
        job, phase = pending.get()
        if job.state['status'] == 'queued':
            job.run(phase)


def _restore():
    """서버가 꺼질 때 돌던 작업은 이어서 할 수 없으므로 중단으로 표시한다 (자막이 있으면 편집 화면에서 다시 만들 수 있다)."""
    JOBS.mkdir(exist_ok=True)
    for d in JOBS.iterdir():
        st = load_state(d)
        if st and st['status'] in ('queued', 'running'):
            st.update(status='error', error='서버가 다시 시작돼 작업이 중단됐어요. 다시 시작해 주세요.')
            (d / 'job.json').write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding='utf-8')


def _job_dir(job_id):
    d = (JOBS / job_id).resolve()
    if d.parent != JOBS.resolve() or not (d / 'job.json').exists():
        raise HTTPException(404, '작업을 찾을 수 없어요.')
    return d


def _job(job_id):
    _job_dir(job_id)
    if job_id not in live:
        live[job_id] = Job.load(JOBS, job_id)
    return live[job_id]


def _state(job_id):
    st = load_state(_job_dir(job_id))
    st['options'] = {k: v for k, v in st.get('options', {}).items() if k != 'voice_file'} | {
        'voice': 'upload' if st.get('options', {}).get('voice_file') else 'source'}
    if st['status'] == 'queued':
        order = [j.id for j, _ in list(pending.queue)]
        st['queuePosition'] = order.index(job_id) + 1 if job_id in order else None
    return st


def _editable(job):
    if job.state['status'] in ('queued', 'running'):
        raise HTTPException(409, '작업이 진행 중이에요. 끝난 뒤에 고쳐 주세요.')
    if not job.subs_path.exists():
        raise HTTPException(409, '아직 자막이 없어요.')


# ── 화면 ─────────────────────────────────────────────────
@app.get('/')
def index():
    return FileResponse(WEB / 'index.html')


@app.get('/techstack.json')
def techstack():
    return FileResponse(ROOT / 'techstack.json')


@app.get('/api/config')
def config():
    return {'langs': LANGS, 'defaults': DEFAULT_TARGETS, 'llm': fit.llm_model()}


# ── 작업 ─────────────────────────────────────────────────
@app.post('/api/jobs')
async def create_job(
    url: str = Form(...),
    targets: str = Form(','.join(DEFAULT_TARGETS)),
    consent: bool = Form(False),
    max_minutes: float | None = Form(None),
    exaggeration: float = Form(0.5),
    cfg_weight: float = Form(0.5),
    source_lang: str = Form(''),
    glossary: str = Form(''),
    review: bool = Form(True),
    voice: UploadFile | None = File(None),
):
    if not consent:
        raise HTTPException(400, '본인 목소리이거나 허락받은 목소리일 때만 만들 수 있어요. 확인란에 체크해 주세요.')
    url = url.strip()
    if not url.startswith(('http://', 'https://')):
        raise HTTPException(400, '유튜브 링크(https://…)를 넣어 주세요.')
    langs = [t for t in targets.split(',') if t in LANGS]
    if not langs:
        raise HTTPException(400, '더빙할 언어를 하나 이상 골라 주세요.')
    if max_minutes is not None and max_minutes <= 0:
        max_minutes = None

    opts = Options(
        url=url, targets=langs, source_lang=source_lang or None, max_minutes=max_minutes,
        exaggeration=min(1.0, max(0.25, exaggeration)), cfg_weight=min(1.0, max(0.1, cfg_weight)),
        glossary=glossary.strip()[:300], review=review,
    )
    job = Job(JOBS, opts)
    job.dir.mkdir(parents=True)
    if voice and voice.filename:
        dst = job.dir / f'voice_upload{Path(voice.filename).suffix.lower()[:8]}'
        with dst.open('wb') as f:
            shutil.copyfileobj(voice.file, f)
        job.opts.voice_file = str(dst)
        job.state['options']['voice_file'] = str(dst)
    job.save()
    live[job.id] = job
    pending.put((job, 'prepare'))
    return _state(job.id)


@app.get('/api/jobs')
def list_jobs():
    states = [st for d in JOBS.iterdir() if d.is_dir() and (st := load_state(d))]
    states.sort(key=lambda s: s['createdAt'], reverse=True)
    return [{k: s.get(k) for k in ('id', 'title', 'url', 'status', 'progress', 'stageLabel', 'targets', 'createdAt', 'duration')} for s in states[:30]]


@app.get('/api/jobs/{job_id}')
def get_job(job_id: str):
    return _state(job_id)


@app.post('/api/jobs/{job_id}/cancel')
def cancel_job(job_id: str):
    job = _job(job_id)
    if job.state['status'] not in ('queued', 'running'):
        raise HTTPException(409, '진행 중인 작업이 아니에요.')
    if job.state['status'] == 'queued':
        job._set(status='canceled', stageLabel='취소됨')
    job.cancel()
    return {'ok': True}


@app.delete('/api/jobs/{job_id}')
def delete_job(job_id: str):
    d = _job_dir(job_id)
    if load_state(d)['status'] in ('queued', 'running'):
        raise HTTPException(409, '진행 중인 작업은 먼저 취소해 주세요.')
    shutil.rmtree(d)
    live.pop(job_id, None)
    return {'ok': True}


# ── 자막 검토·편집 ─────────────────────────────────────────
@app.get('/api/jobs/{job_id}/subtitles')
def get_subtitles(job_id: str):
    job = _job(job_id)
    if not job.subs_path.exists():
        raise HTTPException(404, '아직 자막이 없어요.')
    return {'subtitles': job.load_subs(), 'render': job.load_render(), 'speech': fit.speech(),
            'softSpeed': fit.SOFT_SPEED, 'duration': job.state.get('duration'), 'llm': fit.llm_model()}


@app.put('/api/jobs/{job_id}/subtitles')
def put_subtitles(job_id: str, payload: dict = Body(...)):
    job = _job(job_id)
    _editable(job)
    cur = job.load_subs()
    targets = cur['targets']
    total = float(job.state.get('duration') or 0) or None
    segs = []
    for s in (payload.get('segments') or [])[:3000]:
        try:
            start, end = round(float(s['start']), 3), round(float(s['end']), 3)
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, '시각이 올바르지 않은 줄이 있어요.')
        if not (0 <= start < end) or (total and start > total + 1):
            raise HTTPException(400, f'{start:.2f}초 줄의 시작·끝 시각을 확인해 주세요 (시작 < 끝).')
        tr = s.get('tr') or {}
        frm = s.get('trFrom') or {}
        segs.append({
            'id': str(s.get('id') or f'n{uuid.uuid4().hex[:6]}')[:40],
            'start': start, 'end': end, 'text': str(s.get('text') or '')[:MAX_TEXT],
            'tr': {t: str(tr.get(t) or '')[:MAX_TEXT] for t in targets},
            'trFrom': {t: str(frm.get(t) or '')[:MAX_TEXT] for t in targets},
            **({'shortened': s['shortened']} if isinstance(s.get('shortened'), dict) else {}),
        })
    if not segs:
        raise HTTPException(400, '자막이 비어 있어요. 문장을 하나 이상 남겨 주세요.')
    job.save_subs({**cur, 'segments': segs})
    return {'ok': True, 'count': len(segs)}


@app.post('/api/jobs/{job_id}/retranslate')
def retranslate(job_id: str, payload: dict = Body(...)):
    job = _job(job_id)
    _editable(job)
    ids = set(payload.get('ids') or [])
    if not ids:
        raise HTTPException(400, '다시 번역할 줄을 골라 주세요.')
    return {'subtitles': job.retranslate(ids)}


@app.post('/api/jobs/{job_id}/shorten')
def shorten(job_id: str, payload: dict = Body(...)):
    """한 줄을 원래 시간에 맞게 로컬 AI 로 줄인다 (저장은 화면에서)."""
    job = _job(job_id)
    lang, text, source = payload.get('lang'), str(payload.get('text') or ''), str(payload.get('source') or '')
    slot = float(payload.get('slot') or 0)
    if lang not in LANGS or not text.strip() or slot <= 0:
        raise HTTPException(400, '줄일 문장·언어·시간이 필요해요.')
    model = fit.llm_model()
    if not model:
        raise HTTPException(503, '로컬 AI(Ollama)가 꺼져 있어요. Ollama 를 켜거나 직접 줄여 주세요.')
    src_lang = job.load_subs().get('sourceLang', 'ko') if job.subs_path.exists() else 'ko'
    out = fit.shorten(source, src_lang, text, lang, slot, job.opts.glossary, model)
    if not out:
        raise HTTPException(422, '더 짧게 만들지 못했어요. 직접 줄여 주세요.')
    return {'text': out, 'seconds': round(fit.estimate(out, lang), 2)}


@app.post('/api/jobs/{job_id}/render')
def render(job_id: str):
    job = _job(job_id)
    _editable(job)
    job._set(status='queued', phase='render', stage=None, stageLabel='대기 중', progress=0.0, message='', error=None)
    pending.put((job, 'render'))
    return _state(job_id)


@app.get('/api/jobs/{job_id}/files/{path:path}')
def get_file(job_id: str, path: str, inline: bool = False):
    d = _job_dir(job_id)
    p = (d / path).resolve()
    if d not in p.parents or not p.is_file():  # 작업 폴더 밖은 못 받는다
        raise HTTPException(404, '파일이 없어요.')
    title = safe_name(load_state(d).get('title') or 'video', 40)
    name = p.name if p.suffix == '.zip' else f'{title}_{p.name}'
    return FileResponse(p, filename=name, content_disposition_type='inline' if inline else 'attachment')


# ── 서버 용량 신호등 ───────────────────────────────────────
@app.get('/api/server-health')
def server_health():
    out = {'ok': True, 'uptimeSec': int(time.time() - STARTED), 'memory': None, 'cpuLoad1m': None, 'disk': None, 'level': 'ok', 'reason': ''}
    metrics = {}
    try:
        vm = psutil.virtual_memory()
        out['memory'] = {'usedMB': round((vm.total - vm.available) / 1048576), 'totalMB': round(vm.total / 1048576), 'percent': round(vm.percent, 1)}
        metrics['메모리'] = vm.percent
    except Exception:
        pass
    try:
        du = psutil.disk_usage(str(ROOT))
        out['disk'] = {'usedMB': round(du.used / 1048576), 'totalMB': round(du.total / 1048576), 'percent': round(du.percent, 1)}
        metrics['디스크'] = du.percent
    except Exception:
        pass
    try:
        load1 = os.getloadavg()[0]
        out['cpuLoad1m'] = round(load1, 2)
        metrics['CPU'] = load1 / (os.cpu_count() or 1) * 100
    except Exception:
        pass
    if metrics:
        name, worst = max(metrics.items(), key=lambda kv: kv[1])
        out['level'] = 'critical' if worst >= 95 else 'danger' if worst >= 85 else 'warn' if worst >= 70 else 'ok'
        out['reason'] = f'{name} {worst:.0f}%' if out['level'] != 'ok' else ''
    out['jobs'] = {'running': sum(1 for j in live.values() if j.state['status'] == 'running'), 'queued': pending.qsize()}
    return out


if __name__ == '__main__':
    _restore()
    threading.Thread(target=_worker, daemon=True).start()
    print(f'\n  말.통 더빙 → http://127.0.0.1:{PORT}\n')
    uvicorn.run(app, host='127.0.0.1', port=PORT, log_level='warning')
