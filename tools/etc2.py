#!/usr/bin/env python3
"""ETC2 RGBA (GL_COMPRESSED_RGBA8_ETC2_EAC) for cluster-render's `etc2rgba`
assets: opaque pictures, such as Shadow's photos.

Written from the Khronos ETC1/ETC2 format description. The colour half uses
ETC1's individual and differential modes only; a differential pair is only
chosen when every channel's delta is -4..3, so no block is read as one of
ETC2's T, H or planar modes. The alpha half is EAC with one value for the
whole block (255): these pictures are opaque.

Each 16-byte block is the EAC alpha block, then the colour block, both
big-endian; blocks left to right, rows of blocks top to bottom. A block's
pixels are numbered down the columns: p = x * 4 + y.

    python -X utf8 tools/etc2.py encode IN.rgba W H OUT.etc2
    python -X utf8 tools/etc2.py decode IN.etc2 W H OUT.rgba
"""
import sys

import numpy as np

TABLES = np.array([[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]])
# modifier index (msb << 1 | lsb): 0 = +small, 1 = +large, 2 = -small, 3 = -large
MODS = np.stack([TABLES[:, 0], TABLES[:, 1], -TABLES[:, 0], -TABLES[:, 1]], 1).astype(np.int32)  # (8, 4)
# the two sub-blocks of each flip, as pixel numbers: flip 0 left | right, flip 1 top / bottom
HALVES = {
    0: (np.array([p for p in range(16) if p // 4 < 2]), np.array([p for p in range(16) if p // 4 >= 2])),
    1: (np.array([p for p in range(16) if p % 4 < 2]), np.array([p for p in range(16) if p % 4 >= 2])),
}
NUDGE = np.array([(r, g, b) for r in (-1, 0, 1) for g in (-1, 0, 1) for b in (-1, 0, 1)], np.int32)  # (27, 3)
# EAC: base 255, multiplier 1, table 13 (its index 4 adds 0), every pixel index 4 -> all 255
EAC_TABLE13 = [-1, -2, -3, -10, 0, 1, 2, 9]
OPAQUE_ALPHA = (255 << 56) | (1 << 52) | (13 << 48)
for _p in range(16):
    OPAQUE_ALPHA |= 4 << (45 - 3 * _p)


def to_blocks(img):
    """(H, W, C) -> (blocks, 16, C), pixel p = x * 4 + y, blocks in rows."""
    h, w, c = img.shape
    return img.reshape(h // 4, 4, w // 4, 4, c).transpose(0, 2, 3, 1, 4).reshape(-1, 16, c)


def from_blocks(b, w, h):
    c = b.shape[-1]
    return b.reshape(h // 4, w // 4, 4, 4, c).transpose(0, 3, 1, 2, 4).reshape(h, w, c)


def _expand4(q):
    return q * 17


def _expand5(q):
    return (q << 3) | (q >> 2)


def _half_errors(px, bases):
    """px (B, 8, 3) int, bases (B, K, 3) expanded colours ->
    err (B, K, 8 tables), idx (B, K, 8 tables, 8 pixels) of the best modifier."""
    val = np.clip(bases[:, :, None, None, :] + MODS[None, None, :, :, None], 0, 255)   # B K T M 3
    d = px[:, None, None, None, :, :] - val[:, :, :, :, None, :]                       # B K T M 8 3
    e = (d * d).sum(-1)                                                                  # B K T M 8
    idx = e.argmin(3)                                                                    # B K T 8
    err = e.min(3).sum(-1)                                                               # B K T
    return err, idx


def _encode_colour(rgb):
    """rgb (B, 16, 3) uint8 -> (B,) uint64 ETC1 colour blocks."""
    B = rgb.shape[0]
    px = rgb.astype(np.int32)
    best_err = np.full(B, np.iinfo(np.int64).max, np.int64)
    best_word = np.zeros(B, np.uint64)
    rows = np.arange(B)
    for flip in (0, 1):
        halves = []
        for sel in HALVES[flip]:
            p = px[:, sel, :]
            avg = p.mean(1)
            q4 = np.clip(np.round(avg / 17).astype(np.int32)[:, None, :] + NUDGE[None], 0, 15)
            q5 = np.clip(np.round(avg * 31 / 255).astype(np.int32)[:, None, :] + NUDGE[None], 0, 31)
            e4, i4 = _half_errors(p, _expand4(q4))
            e5, i5 = _half_errors(p, _expand5(q5))
            halves.append((q4, e4, i4, q5, e5, i5))
        (q4a, e4a, i4a, q5a, e5a, i5a), (q4b, e4b, i4b, q5b, e5b, i5b) = halves
        sel_a, sel_b = HALVES[flip]

        # individual: each half its own 4-bit colour and table
        fa, fb = e4a.reshape(B, -1), e4b.reshape(B, -1)
        ma, mb = fa.argmin(1), fb.argmin(1)
        ind_err = fa[rows, ma].astype(np.int64) + fb[rows, mb]
        ka, ta = np.divmod(ma, 8)
        kb, tb = np.divmod(mb, 8)
        ind = dict(c1=q4a[rows, ka], c2=q4b[rows, kb], t1=ta, t2=tb,
                   i1=i4a[rows, ka, ta], i2=i4b[rows, kb, tb])

        # differential: a 5-bit colour and a -4..3 delta to the second
        ta5, tb5 = e5a.argmin(2), e5b.argmin(2)                          # best table per candidate
        ea, eb = e5a.min(2).astype(np.int64), e5b.min(2).astype(np.int64)  # B 27
        delta = q5b[:, None, :, :] - q5a[:, :, None, :]                   # B 27a 27b 3
        ok = ((delta >= -4) & (delta <= 3)).all(-1)
        pair = np.where(ok, ea[:, :, None] + eb[:, None, :], np.iinfo(np.int64).max)
        flat = pair.reshape(B, -1)
        pm = flat.argmin(1)
        dif_err = flat[rows, pm]
        ka5, kb5 = np.divmod(pm, 27)
        t1d, t2d = ta5[rows, ka5], tb5[rows, kb5]
        dif = dict(c1=q5a[rows, ka5], c2=q5b[rows, kb5], t1=t1d, t2=t2d,
                   i1=i5a[rows, ka5, t1d], i2=i5b[rows, kb5, t2d])

        for diff, m, err in ((0, ind, ind_err), (1, dif, dif_err)):
            word = _pack(flip, diff, m, sel_a, sel_b)
            better = err < best_err
            best_err = np.where(better, err, best_err)
            best_word = np.where(better, word, best_word)
    return best_word


def _pack(flip, diff, m, sel_a, sel_b):
    u = lambda a: np.asarray(a).astype(np.uint64)
    v = np.zeros(m['c1'].shape[0], np.uint64)
    for ch in range(3):
        if diff:
            d = (m['c2'][:, ch] - m['c1'][:, ch]) & 7
            v |= ((u(m['c1'][:, ch]) << u(3)) | u(d)) << u(56 - 8 * ch)
        else:
            v |= ((u(m['c1'][:, ch]) << u(4)) | u(m['c2'][:, ch])) << u(56 - 8 * ch)
    v |= u(m['t1']) << u(37)
    v |= u(m['t2']) << u(34)
    v |= u(diff) << u(33)
    v |= u(flip) << u(32)
    for sel, idx in ((sel_a, m['i1']), (sel_b, m['i2'])):
        for j, p in enumerate(sel):
            mi = u(idx[:, j])
            v |= (mi >> u(1)) << u(16 + int(p))
            v |= (mi & u(1)) << u(int(p))
    return v


def encode(img, chunk=512):
    """(H, W, 4) uint8, opaque, H and W multiples of 4 -> etc2rgba bytes."""
    h, w, _ = img.shape
    if h % 4 or w % 4:
        raise ValueError('width and height must be multiples of 4')
    if not (img[..., 3] == 255).all():
        raise ValueError('only opaque pictures: the alpha half is written as 255')
    blocks = to_blocks(img[..., :3])
    words = np.concatenate([_encode_colour(blocks[i:i + chunk]) for i in range(0, blocks.shape[0], chunk)])
    out = np.empty((words.shape[0], 2), '>u8')
    out[:, 0] = OPAQUE_ALPHA
    out[:, 1] = words
    return out.tobytes()


def decode(data, w, h):
    """etc2rgba bytes as this encoder writes them -> (H, W, 4) uint8."""
    raw = np.frombuffer(data, '>u8').reshape(-1, 2)
    a, v = raw[:, 0].astype(np.uint64), raw[:, 1].astype(np.uint64)
    B = v.shape[0]
    bits = lambda x, s, n: ((x >> np.uint64(s)) & np.uint64((1 << n) - 1)).astype(np.int32)
    diff, flip = bits(v, 33, 1), bits(v, 32, 1)
    c1 = np.zeros((B, 3), np.int32)
    c2 = np.zeros((B, 3), np.int32)
    for ch in range(3):
        b5 = bits(v, 59 - 8 * ch, 5)
        d = bits(v, 56 - 8 * ch, 3)
        d = np.where(d >= 4, d - 8, d)
        c2d = b5 + d
        if ((diff == 1) & ((c2d < 0) | (c2d > 31))).any():
            raise ValueError('a T, H or planar block: not written by this encoder')
        c1[:, ch] = np.where(diff == 1, _expand5(b5), _expand4(bits(v, 60 - 8 * ch, 4)))
        c2[:, ch] = np.where(diff == 1, _expand5(np.clip(c2d, 0, 31)), _expand4(bits(v, 56 - 8 * ch, 4)))
    t1, t2 = bits(v, 37, 3), bits(v, 34, 3)
    out = np.zeros((B, 16, 4), np.uint8)
    for p in range(16):
        m = (bits(v, 16 + p, 1) << 1) | bits(v, p, 1)
        second = np.where(flip == 1, p % 4 >= 2, p // 4 >= 2)
        base = np.where(second[:, None], c2, c1)
        mod = np.where(second, MODS[t2, m], MODS[t1, m])
        out[:, p, :3] = np.clip(base + mod[:, None], 0, 255)
        ai = bits(a, 45 - 3 * p, 3)
        tab = bits(a, 48, 4)
        if (tab != 13).any():
            raise ValueError('an alpha block not written by this encoder')
        out[:, p, 3] = np.clip(bits(a, 56, 8) + np.array(EAC_TABLE13)[ai] * bits(a, 52, 4), 0, 255)
    return from_blocks(out, w, h)


def psnr(a, b):
    mse = ((a[..., :3].astype(np.float64) - b[..., :3]) ** 2).mean()
    return float('inf') if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def main(argv):
    if len(argv) == 6 and argv[1] in ('encode', 'decode'):
        w, h = int(argv[3]), int(argv[4])
        if argv[1] == 'encode':
            img = np.fromfile(argv[2], np.uint8).reshape(h, w, 4)
            open(argv[5], 'wb').write(encode(img))
        else:
            decode(open(argv[2], 'rb').read(), w, h).tofile(argv[5])
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
