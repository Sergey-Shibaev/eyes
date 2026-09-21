# -*- coding: utf-8 -*-
"""Делает из записи бесшовное музыкальное кольцо для приложения.

Запуск (нужны python с numpy и scipy, а также ffmpeg):
    python tools/make-music-loop.py "путь/к/записи.mp4" --start 16.5 --end 171.0

Что происходит:
  1. Из записи достаётся звук.
  2. Точка конца подгоняется к точке начала по рисунку ударов по струнам (в пределах ±0,4 с),
     чтобы ритм на стыке не спотыкался.
  3. Хвост после точки конца плавно перетекает в начало (равномощный переход CROSS секунд):
     когда кольцо доигрывает, оно уже звучит как собственное начало.
  4. Громкость выравнивается (см. level_loop): живая запись арфы тихая (около −23 LUFS,
     вступление ещё на 5 дБ тише), и на динамике телефона её было почти не слышно.
     Кольцо приводится к TARGET_LUFS, тихие места чуть подтягиваются, пики ограничиваются.
     Всё это считается по кругу, как будто кольцо играет бесконечно, — стык остаётся бесшовным.
  5. По краям файла добавляется запас GUARD секунд — продолжение кольца по кругу.
     Сжатие в MP3 портит самые края файла; приложение играет только середину,
     от loopStart до loopEnd, и порченые края в кольцо не попадают.

На выходе: music/loop.mp3 и music/loop.json (границы кольца для приложения).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import stft

CROSS = 3.0   # секунд плавного перехода конца в начало
GUARD = 0.5   # секунд запаса по краям файла
RATE = 44100

# Громкость. −16 LUFS — обычная громкость музыки в телефоне; тише делает уже приложение
# (music.js: ползунок на середине — около −22 LUFS, чтобы колокольчик упражнения был слышен поверх).
TARGET_LUFS = -16.0
PEAK_CEILING_DB = -1.5  # потолок пиков в WAV; MP3 добавляет свои выбросы, итог проверяется замером
LEVEL_WINDOW = 3.0  # секунд: по такому окну судим, тихое место или громкое
LEVEL_RATIO = 0.5   # какую долю разницы с средней громкостью убираем (0 — никакой, 1 — всё ровно)
LEVEL_BOOST_DB = 4.0  # тихие места поднимаем не больше чем на столько: иначе вылезет шум записи
LEVEL_CUT_DB = 6.0
LIMIT_HOLD = 0.005  # секунд: окно, в котором ищем пик
LIMIT_RELEASE = 0.08  # секунд: как плавно ограничитель отпускает после пика


def run(cmd):
    return subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def loudness(x, sr, tmp):
    """Интегральная громкость (LUFS) и истинный пик (dBTP) по EBU R128 — замер делает ffmpeg."""
    path = os.path.join(tmp, 'measure.wav')
    wavfile.write(path, sr, np.clip(x, -1, 1).astype(np.float32))
    err = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr
    text = err.decode('utf-8', 'replace').split('Summary:')[-1]
    lufs = float(re.search(r'I:\s*(-?[\d.]+) LUFS', text).group(1))
    peak = float(re.search(r'Peak:\s*(-?[\d.inf]+) dBFS', text).group(1))
    return lufs, peak


def level_loop(loop, sr):
    """Мягко выравнивает тихие и громкие места — как звукорежиссёр, который медленно ведёт фейдер.
    Окна замыкаются по кругу (mode='wrap'): конец кольца видит его начало, стык не прыгает."""
    power = (loop.astype(np.float64) ** 2).mean(axis=1)
    w = int(LEVEL_WINDOW * sr)
    local_db = 10 * np.log10(uniform_filter1d(power, size=w, mode='wrap') + 1e-12)
    mean_db = 10 * np.log10(power.mean() + 1e-12)
    gain_db = np.clip(-LEVEL_RATIO * (local_db - mean_db), -LEVEL_CUT_DB, LEVEL_BOOST_DB)
    gain_db = uniform_filter1d(gain_db, size=w, mode='wrap')  # фейдер движется плавно, за секунды
    return (loop * (10 ** (gain_db / 20))[:, None]).astype(np.float32)


def limit_loop(loop, sr, ceiling):
    """Ограничитель пиков без заглядывания за край: тоже по кругу.
    Сначала минимум нужного усиления в окне (пик не пройдёт выше потолка), затем удержание
    и сглаживание окном той же ширины — сглаженное усиление никогда не выше нужного в пике."""
    need = np.minimum(1.0, ceiling / np.maximum(np.abs(loop).max(axis=1), 1e-9))
    m = minimum_filter1d(need, size=2 * int(LIMIT_HOLD * sr) + 1, mode='wrap')
    r = 2 * int(LIMIT_RELEASE * sr) + 1
    g = uniform_filter1d(minimum_filter1d(m, size=r, mode='wrap'), size=r, mode='wrap')
    return (loop * np.minimum(g, m)[:, None]).astype(np.float32)


def normalize_loop(loop, sr, tmp):
    """Выравнивание, подгонка к TARGET_LUFS и ограничение пиков. Возвращает кольцо и замеры."""
    before = loudness(loop, sr, tmp)
    x = level_loop(loop, sr)
    ceiling = 10 ** (PEAK_CEILING_DB / 20)
    gain_db = TARGET_LUFS - loudness(x, sr, tmp)[0]
    # ограничитель съедает немного громкости — следующий проход добирает её
    for _ in range(3):
        raised = x * 10 ** (gain_db / 20)
        y = limit_loop(raised, sr, ceiling)
        lufs, _ = loudness(y, sr, tmp)
        if abs(lufs - TARGET_LUFS) < 0.2:
            break
        gain_db += TARGET_LUFS - lufs
    return y, {'lufs_before': before[0], 'peak_before_dbtp': before[1], 'lufs_after_wav': lufs,
               'gain_db': round(gain_db, 2),
               'limited_share': round(float(np.mean(np.abs(raised).max(axis=1) > ceiling)), 5)}


def onset_envelope(x, sr, hop):
    """Сила «ударов» во времени: насколько резко прибавилась энергия по спектру."""
    _, _, z = stft(x, fs=sr, nperseg=1024, noverlap=1024 - hop, padded=False)
    mag = np.log1p(np.abs(z) * 100)
    flux = np.maximum(0, np.diff(mag, axis=1)).sum(axis=0)
    return flux - flux.mean()


def refine_end(mono, sr, start, end, window=4.0, reach=0.4):
    """Сдвигает точку конца так, чтобы удары по струнам после неё легли на удары после начала."""
    hop = 128
    env = onset_envelope(mono, sr, hop)
    per_sec = sr / hop
    a = int(start * per_sec)
    w = int(window * per_sec)
    ref = env[a:a + w]
    best_shift, best_score = 0, -np.inf
    for shift in range(-int(reach * per_sec), int(reach * per_sec) + 1):
        b = int(end * per_sec) + shift
        seg = env[b:b + w]
        if len(seg) < w:
            continue
        score = float(np.dot(ref, seg) / (np.linalg.norm(ref) * np.linalg.norm(seg) + 1e-9))
        if score > best_score:
            best_shift, best_score = shift, score
    return end + best_shift / per_sec, best_score


def main():
    ap = argparse.ArgumentParser(description='Бесшовное музыкальное кольцо из записи')
    ap.add_argument('source', help='видео или аудио с музыкой')
    ap.add_argument('--start', type=float, required=True, help='секунда, с которой начинается кольцо')
    ap.add_argument('--end', type=float, required=True, help='секунда, где музыка звучит так же, как в начале')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'music'))
    ap.add_argument('--bitrate', default='128k')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='loop-')
    wav = os.path.join(tmp, 'source.wav')
    # лёгкий срез гула ниже 50 Гц: ветер и шорох рук по телефону
    run(['ffmpeg', '-v', 'error', '-y', '-i', args.source, '-vn', '-ar', str(RATE), '-ac', '2',
         '-af', 'highpass=f=50', '-c:a', 'pcm_s16le', wav])

    sr, x = wavfile.read(wav)
    x = x.astype(np.float32) / 32768.0
    mono = x.mean(axis=1)

    end, score = refine_end(mono, sr, args.start, args.end)
    a = int(round(args.start * sr))
    b = int(round(end * sr))
    c = int(round(CROSS * sr))
    g = int(round(GUARD * sr))
    if b + c > len(x):
        sys.exit('После точки конца не хватает звука на переход: возьмите --end пораньше.')
    n = b - a  # длина кольца

    # Кольцо: сначала тело X[a+c .. b], затем переход — хвост X[b .. b+c] затихает, начало X[a .. a+c] нарастает.
    # Последний отсчёт перехода — это X[a+c], то есть ровно начало кольца: стык непрерывен.
    fade = np.linspace(0, np.pi / 2, c, dtype=np.float32)[:, None]
    cross = x[b:b + c] * np.cos(fade) + x[a:a + c] * np.sin(fade)
    loop = np.concatenate([x[a + c:b], cross])
    assert len(loop) == n
    loop, level = normalize_loop(loop, sr, tmp)

    # Запас по краям — продолжение кольца по кругу
    padded = np.concatenate([loop[-g:], loop, loop[:g]])
    peak = float(np.abs(padded).max())
    if peak > 0.98:
        padded *= 0.98 / peak

    out_wav = os.path.join(tmp, 'loop.wav')
    wavfile.write(out_wav, sr, (padded * 32767).astype(np.int16))
    out_mp3 = os.path.join(args.out, 'loop.mp3')
    run(['ffmpeg', '-v', 'error', '-y', '-i', out_wav, '-c:a', 'libmp3lame', '-b:a', args.bitrate,
         '-joint_stereo', '1', out_mp3])

    # Насколько ровно звучит переход: громкость в зоне перехода против соседних секунд
    def db(seg):
        return float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9))
    info = {
        'loopStart': GUARD,
        'loopEnd': round(GUARD + n / sr, 6),
        'duration': round(len(padded) / sr, 6),
        'source': {'start': args.start, 'end': round(end, 3), 'cross': CROSS},
    }
    with open(os.path.join(args.out, 'loop.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        'end_refined': round(end, 3), 'onset_match': round(score, 3), 'loop_seconds': round(n / sr, 2),
        'level_before_cross_db': round(db(loop[-c - sr:-c]), 1), 'level_in_cross_db': round(db(cross), 1),
        'level_after_cross_db': round(db(loop[:sr]), 1),
        'seam_step': round(float(np.abs(loop[-1] - loop[0]).max()), 5),
        'typical_step': round(float(np.abs(np.diff(loop[:sr], axis=0)).mean()), 5),
        'mp3_bytes': os.path.getsize(out_mp3), **level, **info,
    }, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
