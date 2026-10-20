# 말.통 더빙 — 유튜브 영상을 내 목소리로 6개 언어 더빙

유튜브 링크를 넣으면 **음성 인식(시간·문장) → 번역 → 원래 목소리로 다국어 합성 → 영상·음성·자막 내려받기**까지 한 번에 합니다.
음성 인식(Whisper)과 목소리 합성(Chatterbox)은 전부 이 Mac 에서 돌아요.

> ⚠️ **본인 목소리이거나 허락받은 목소리만** 쓰세요. 결과물을 공개할 때는 "AI 음성"이라고 밝혀 주세요.

## 실행 — 세 가지 방법

| 방법 | 어떻게 | 언제 |
|---|---|---|
| **① 바탕화면 앱** | `말통 더빙.app` 더블클릭 (또는 이 폴더의 `말통 더빙 실행.command`) | 이 Mac 에서 가장 쉽게 |
| **② 터미널** | `npm run dub` (또는 `sh dubbing/run.sh`) | 개발할 때 |
| **③ Colab 무료 GPU** | [**Colab 에서 열기**](https://colab.research.google.com/github/herwoojin/multi_chat/blob/main/dubbing/colab/maltong_dubbing.ipynb) → 칸 채우고 ▶ 한 번 | 긴 영상 · 이 Mac 이 없을 때 (몇 배 빠름) |

①·② 는 브라우저에서 **http://127.0.0.1:8790** 이 자동으로 열립니다. 터미널 창을 닫으면 꺼져요.
처음 실행하면 Python 3.11 가상환경과 패키지를 설치하고(몇 분), 첫 작업 때 더빙 모델(약 3GB)을 내려받습니다.
필요한 것: Apple Silicon Mac, `ffmpeg`, `uv` — 없으면 실행 파일이 Homebrew 로 알아서 설치합니다.

**Colab** 은 열면 T4 GPU 가 자동으로 잡히고, 전용 Python 3.11 환경을 따로 만들어 설치하므로 Colab 기본 패키지와 버전이 충돌하지 않습니다(처음 3~5분, 이후 바로 시작). 유튜브가 Colab 에서의 내려받기를 막으면(봇 확인) 그 영상 파일을 올리라는 창이 뜹니다. 끝나면 전체 zip 이 자동으로 내려받아져요.

## 쓰는 법

1. 유튜브 링크를 붙여넣는다
2. 더빙할 언어를 고른다 (기본: 영어·중국어·일본어·스페인어·독일어·프랑스어)
3. 목소리 — **영상 속 목소리**(말소리가 이어지는 10~20초를 자동으로 고름) 또는 **내 목소리 파일**(10~30초)
4. 처음엔 **앞부분 1~2분만**으로 시험해 본다
5. 동의 확인란에 체크하고 **더빙 시작**

끝난 언어부터 바로 미리 보고 내려받을 수 있습니다.

| 파일 | 내용 |
|---|---|
| `<언어>/video_<언어>.mp4` | 더빙 영상 — 자막 트랙 포함 (플레이어에서 켜고 끔) |
| `<언어>/dub_<언어>.mp3` | 더빙 음성만 |
| `<언어>/subtitles_<언어>.srt` | 번역 자막 (더빙 음성 시각에 맞춤) |
| `subtitles_<원래언어>_original.srt` | 원문 자막 |
| `transcript.json` | 문장별 시간·원문·번역 |
| `*_dubbed.zip` | 위 전부 |

## 걸리는 시간 (MacBook Air M4 · 16GB)

영상 **1분 · 언어 하나에 약 8~12분** 걸립니다 (실측: 30초 영상 × 2개 언어 = 12분). 6개 언어면 1분 영상에 1시간 안팎이에요.
팬이 없는 MacBook Air 는 오래 돌리면 열 때문에 조금씩 느려집니다. 긴 영상은 "앞부분만"으로 나눠 돌리거나, CUDA GPU(Colab T4 등)를 쓰는 편이 빠릅니다.
화면에 남은 시간이 표시되고, 다른 일을 해도 계속 돌아갑니다(서버 창만 켜 두세요).

## 명령줄

```bash
cd dubbing
.venv/bin/python -m dubber "https://youtu.be/…" --minutes 2 --langs en,ja --i-have-permission
.venv/bin/python -m dubber "https://youtu.be/…" --voice ~/my_voice.m4a --i-have-permission
.venv/bin/python -m dubber ~/Movies/my_video.mp4 --i-have-permission     # 내 영상·음성 파일
```

음성 인식은 Apple Silicon 에서 MLX Whisper, 그 밖(Colab·Windows·Intel)에서는 openai-whisper 로 자동으로 바뀝니다 (`requirements-gpu.txt`).

## 문제가 생기면

| 증상 | 해결 |
|---|---|
| 영상을 내려받지 못함 | 유튜브가 바뀐 것 — `uv pip install -U yt-dlp -p dubbing/.venv/bin/python` |
| `'NoneType' object is not callable` (모델 로드) | `setuptools<81` 이 빠진 것 — `uv pip install "setuptools<81" -p dubbing/.venv/bin/python` |
| Colab 에서 "Sign in to confirm you're not a bot" | 유튜브가 서버 내려받기를 막은 것 — 뜨는 창에서 같은 영상 파일을 올리기 |
| 결과 목소리가 탁함 | 견본에 배경음악이 섞인 것 — 깨끗한 내 목소리 파일을 올리기 |
| 말이 너무 빠르거나 밀림 | 고급 설정에서 "말 속도·차분함"을 높이거나, 번역이 긴 언어는 감안 |

결과물은 `dubbing/jobs/<작업id>/` 에 쌓입니다 (git 에 올라가지 않음). 화면의 **삭제**로 지울 수 있어요.
구성과 한계는 [TECH_STACK.md](./TECH_STACK.md) 참고. 원본 Colab 노트북의 Chatterbox 코드를 로컬용으로 옮긴 것입니다.
