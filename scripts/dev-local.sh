#!/usr/bin/env sh
# 실제 Firebase 프로젝트 없이 전체 앱을 로컬에서 띄운다.
#   Auth · Firestore · Storage 에뮬레이터(demo-maltong) + Vite 개발 서버(Functions 포함)
#   종료(Ctrl+C) 시 테스트 데이터를 .emulator-data/ 에 저장하고 다음 실행 때 불러온다.
set -e

# Firestore 에뮬레이터는 Java 가 필요하다. macOS 의 /usr/bin/java 는 JDK 가 없으면 빈 껍데기이므로
# Homebrew openjdk(keg-only)를 찾아 PATH 앞에 붙인다.
if ! java -version >/dev/null 2>&1; then
  for d in /opt/homebrew/opt/openjdk/bin /usr/local/opt/openjdk/bin; do
    if [ -x "$d/java" ]; then PATH="$d:$PATH"; export PATH; break; fi
  done
fi
java -version >/dev/null 2>&1 || { echo "✖ Java 가 필요합니다: brew install openjdk"; exit 1; }
command -v firebase >/dev/null 2>&1 || { echo "✖ Firebase CLI 가 필요합니다: npm i -g firebase-tools"; exit 1; }

DATA=.emulator-data
IMPORT=""
[ -f "$DATA/firebase-export-metadata.json" ] && IMPORT="--import=$DATA"

exec firebase emulators:exec --project demo-maltong --ui $IMPORT --export-on-exit="$DATA" "vite --mode emulator"
