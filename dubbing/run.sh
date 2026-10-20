#!/usr/bin/env sh
# 말.통 더빙 서버를 띄운다 → http://127.0.0.1:8790
# 처음이면 Python 3.11 가상환경을 만들고 패키지를 설치한다 (몇 분). 더빙 모델(약 3GB)은 첫 작업 때 내려받는다.
set -e
cd "$(dirname "$0")"

command -v ffmpeg >/dev/null 2>&1 || { echo "✖ ffmpeg 가 필요합니다: brew install ffmpeg"; exit 1; }
command -v uv >/dev/null 2>&1 || { echo "✖ uv 가 필요합니다: brew install uv"; exit 1; }

[ -x .venv/bin/python ] || uv venv -q -p 3.11 .venv
if [ ! -f .venv/.installed ] || [ requirements.txt -nt .venv/.installed ]; then
  echo "패키지 설치 중…"
  uv pip install -q -p .venv/bin/python -r requirements.txt
  touch .venv/.installed
fi

# 경고 대신 진행 상황만 보이게
export PYTHONWARNINGS="ignore"
exec .venv/bin/python server.py "$@"
