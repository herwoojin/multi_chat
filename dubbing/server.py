"""말.통 더빙 — 로컬 웹 서버 (http://127.0.0.1:8790).
더빙은 GPU(MPS)를 오래 쓰므로 한 번에 한 작업씩 줄 세워 처리한다.
"""
import os
import queue
import shutil
import threading
import time
from pathlib import Path

import psutil
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from dubber.langs import DEFAULT_TARGETS, LANGS
from dubber.pipeline import Job, Options, load_state, safe_name

ROOT = Path(__file__).resolve().parent
JOBS = ROOT / 'jobs'
WEB = ROOT / 'web'
PORT = int(os.environ.get('DUB_PORT', '8790'))
STARTED = time.time()

app = FastAPI(title='말.통 더빙')
live: dict[str, Job] = {}
pending: 'queue.Queue[Job]' = queue.Queue()


def _worker():
    while True:
        job = pending.get()
        if job.state['status'] == 'queued':
            job.run()


def _restore():
    """서버가 꺼질 때 돌던 작업은 이어서 할 수 없으므로 중단으로 표시한다."""
    JOBS.mkdir(exist_ok=True)
    for d in JOBS.iterdir():
        st = load_state(d)
        if st and st['status'] in ('queued', 'running'):
            st.update(status='error', error='서버가 다시 시작돼 작업이 중단됐어요. 다시 시작해 주세요.')
            (d / 'job.json').write_text(__import__('json').dumps(st, ensure_ascii=False, indent=1), encoding='utf-8')


def _job_dir(job_id):
    d = (JOBS / job_id).resolve()
    if d.parent != JOBS.resolve() or not (d / 'job.json').exists():
        raise HTTPException(404, '작업을 찾을 수 없어요.')
    return d


def _state(job_id):
    st = load_state(_job_dir(job_id))
    if st['status'] == 'queued':
        order = [j.id for j in list(pending.queue)]
        st['queuePosition'] = order.index(job_id) + 1 if job_id in order else None
    return st


# ── 화면 ─────────────────────────────────────────────────
@app.get('/')
def index():
    return FileResponse(WEB / 'index.html')


@app.get('/techstack.json')
def techstack():
    return FileResponse(ROOT / 'techstack.json')


@app.get('/api/config')
def config():
    return {'langs': LANGS, 'defaults': DEFAULT_TARGETS}


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
    )
    job = Job(JOBS, opts)
    job.dir.mkdir(parents=True)
    if voice and voice.filename:
        dst = job.dir / f'voice_upload{Path(voice.filename).suffix.lower()[:8]}'
        with dst.open('wb') as f:
            shutil.copyfileobj(voice.file, f)
        job.opts.voice_file = str(dst)
        job.state['options']['voice'] = 'upload'
    job.save()
    live[job.id] = job
    pending.put(job)
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
    _job_dir(job_id)
    job = live.get(job_id)
    if not job or job.state['status'] not in ('queued', 'running'):
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
