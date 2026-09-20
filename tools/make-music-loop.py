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
  4. По краям файла добавляется запас GUARD секунд — продолжение кольца по кругу.
     Сжатие в MP3 портит самые края файла; приложение играет только середину,
     от loopStart до loopEnd, и порченые края в кольцо не попадают.

На выходе: music/loop.mp3 и music/loop.json (границы кольца для приложения).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft

CROSS = 3.0   # секунд плавного перехода конца в начало
GUARD = 0.5   # секунд запаса по краям файла
RATE = 44100


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


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
        'mp3_bytes': os.path.getsize(out_mp3), **info,
    }, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
