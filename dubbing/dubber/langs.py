"""더빙 언어 표 — 키는 Chatterbox 언어 코드. 번역(gtx)·mp4 자막 트랙(ISO 639-2) 코드를 함께 둔다."""

LANGS = {
    'ko': {'name': '한국어', 'flag': '🇰🇷', 'gtx': 'ko', 'iso3': 'kor'},
    'en': {'name': 'English', 'flag': '🇺🇸', 'gtx': 'en', 'iso3': 'eng'},
    'zh': {'name': '中文', 'flag': '🇨🇳', 'gtx': 'zh-CN', 'iso3': 'zho'},
    'ja': {'name': '日本語', 'flag': '🇯🇵', 'gtx': 'ja', 'iso3': 'jpn'},
    'es': {'name': 'Español', 'flag': '🇪🇸', 'gtx': 'es', 'iso3': 'spa'},
    'de': {'name': 'Deutsch', 'flag': '🇩🇪', 'gtx': 'de', 'iso3': 'deu'},
    'fr': {'name': 'Français', 'flag': '🇫🇷', 'gtx': 'fr', 'iso3': 'fra'},
}

# 요청받은 기본 대상: 한국어 → 영어·중국어·일본어·스페인어·독일어·프랑스어
DEFAULT_TARGETS = ['en', 'zh', 'ja', 'es', 'de', 'fr']


def gtx_code(lang):
    return LANGS.get(lang, {}).get('gtx', lang or 'auto')


def iso3(lang):
    return LANGS.get(lang, {}).get('iso3', 'und')


def label(lang):
    info = LANGS.get(lang)
    return f"{info['flag']} {info['name']}" if info else lang
