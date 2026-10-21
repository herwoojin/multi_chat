"""말.통 더빙 — 유튜브 영상을 내 목소리(원래 화자의 목소리)로 여러 언어 더빙한다. 전부 이 컴퓨터에서 돈다."""

# 회사·보안 프로그램(예: Somansa)이 HTTPS 를 중간에서 검사하는 네트워크에서는 Python 기본 인증서 목록(certifi)이
# 그 인증서를 몰라 유튜브·번역·모델 내려받기가 모두 CERTIFICATE_VERIFY_FAILED 로 실패한다.
# 운영체제(Mac 키체인)가 믿는 인증서를 Python 도 믿게 한다 — 검증을 끄는 것이 아니다.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # 옛 가상환경이면 기본 동작 (run.sh 가 다음 실행 때 설치한다)
    pass
