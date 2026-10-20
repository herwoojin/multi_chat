#!/bin/zsh
# 더블클릭하면 말.통 더빙을 켜고 브라우저를 엽니다. 이 창을 닫으면 더빙 서버가 꺼져요.
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
URL="http://127.0.0.1:${DUB_PORT:-8790}"

echo "🎙 말.통 더빙"

# 이미 켜져 있으면 브라우저만 연다
if curl -s -o /dev/null "$URL/api/config"; then
  echo "이미 켜져 있어요 → $URL"
  [ -z "$DUB_NO_OPEN" ] && open "$URL"
  exit 0
fi

# 처음 한 번: ffmpeg·uv 가 없으면 Homebrew 로 설치한다
for tool in ffmpeg uv; do
  if ! command -v $tool >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      echo "$tool 설치 중…"
      brew install $tool || exit 1
    else
      echo "✖ $tool 이 필요해요. https://brew.sh 에서 Homebrew 를 설치한 뒤 다시 실행해 주세요."
      read -k1 "?아무 키나 누르면 닫혀요"
      exit 1
    fi
  fi
done

# 서버가 뜨면 브라우저를 연다 (처음엔 설치 때문에 몇 분 걸릴 수 있다)
( for i in {1..900}; do
    curl -s -o /dev/null "$URL/api/config" && { [ -z "$DUB_NO_OPEN" ] && open "$URL"; break; }
    sleep 1
  done ) &

echo "처음이면 설치에 몇 분 걸려요. 브라우저가 자동으로 열립니다."
echo "이 창을 닫으면 더빙 서버가 꺼져요."
exec ./run.sh
