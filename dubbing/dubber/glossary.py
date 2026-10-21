"""자주 나오는 단어(용어집)로 음성 인식 결과를 바로잡는다.

Whisper 에 용어를 힌트로 주면 엉뚱한 곳이 틀어지기도 해서(실측: '지하 2층' → '지하 D층'),
받아쓴 뒤에 한글 자모 단위로 아주 비슷한 말만 골라 용어로 바꾼다. 바꾼 곳은 모두 기록해 화면에 보여 준다.
  재미나이로 → 제미나이로   (자모 8개 중 1개 다름)
  앱 시트로  → 앱시트로     (띄어쓰기)
  기터브     → 깃허브
"""
import difflib
import re

CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
        'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
THRESHOLD = 0.75
# 용어 뒤에 붙어도 되는 것 — 조사·서술격 조사·문장부호뿐 (다른 낱말 한가운데를 바꾸지 않게)
TAIL = re.compile(r'(은|는|이|가|을|를|에|의|로|으로|와|과|도|만|에서|까지|부터|처럼|보다|랑|이랑|에게|한테|이나|나|이에요|예요|입니다|이다|이고|고)?[^\w가-힣]*')


def jamo(s):
    out = []
    for ch in s.lower():
        c = ord(ch) - 0xAC00
        if 0 <= c < 11172:
            out += [CHO[c // 588], JUNG[(c % 588) // 28]] + ([JONG[c % 28]] if c % 28 else [])
        elif not ch.isspace():
            out.append(ch)
    return ''.join(out)


def terms(glossary):
    return [t.strip() for t in re.split(r'[,\n]', glossary or '') if len(t.replace(' ', '').strip()) >= 2]


def fix(text, glossary):
    """@returns (고친 문장, [(바꾸기 전, 바꾼 뒤)])"""
    changes = []
    words = text.split(' ')
    for term in terms(glossary):
        tc = term.replace(' ', '')
        tj, n = jamo(tc), len(tc)
        lengths = [n, n + 1] + ([n - 1] if n >= 4 else [])  # 짧은 용어는 더 짧은 말과 비교하지 않는다
        i = 0
        while i < len(words):
            for k in (1, 2, 3):  # 띄어 쓴 경우("앱 시트로")까지 이어 보고 비교
                if i + k > len(words):
                    break
                joined = ''.join(words[i:i + k])
                hit = None
                for L in lengths:
                    if L < 2 or L > len(joined):
                        continue
                    head, tail = joined[:L], joined[L:]
                    if not TAIL.fullmatch(tail):
                        continue
                    if head == tc and k == 1:
                        hit = 'same'
                        break
                    if difflib.SequenceMatcher(None, jamo(head), tj).ratio() >= THRESHOLD:
                        hit = term + tail
                        break
                if hit == 'same':
                    break
                if hit:
                    before = ' '.join(words[i:i + k])
                    if before != hit:
                        words[i:i + k] = [hit]
                        changes.append((before, hit))
                    break
            i += 1
    return ' '.join(words), changes
