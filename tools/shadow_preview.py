#!/usr/bin/env python3
"""Export render_shadow's real runtime pixels, plus 2x right-panel crops.

Also verify the black warning row and glyph/quad fit against the actual local
atlases. Nearest-neighbour 2x crops deliberately expose seams or clipped ink.
"""
import json
from pathlib import Path
import sys
import struct
import zlib
from shadow_geom import ART_RIGHT

ROOT = Path(__file__).resolve().parent.parent
VALUES = {'clusterstatus': 'SYSTEM // 同期中', 'speed': '96', 'rpm': '4550',
          'range': '498', 'coolant': '88', 'time': '14:32', 'u:speed': 'KM/H',
          'u:range': 'KM', 'u:temp': '°C', 'gearcap': 'CURRENT GEAR',
          'gearcapjp': '主変速器', 'sync': '62.8'}


def png(path, pixels, width, height):
    """Lossless RGBA writer; previews don't require Pillow or substitute fonts."""
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data))
    rows = b''.join(b'\0'+pixels[y*width*4:(y+1)*width*4] for y in range(height))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+
                     chunk(b'IHDR', struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+
                     chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b''))


def main(out):
    out = Path(out)
    fonts = {}
    for mode in ART_RIGHT:
        pixels = (out/(mode+'.rgba')).read_bytes()
        assert len(pixels)==1920*720*4
        bottom = pixels[636*1920*4:]
        assert all(bottom[i:i+3]==b'\0\0\0' for i in range(0,len(bottom),4)), 'nonblack BMW warning row'
        png(out/(mode+'.png'),pixels,1920,720)
        # Eco's crop starts before the moved slogan so the gap to the gear window is visible.
        left = 960 if mode == 'eco' else ART_RIGHT[mode]
        crop_width = 1920 - left
        rows = []
        for y in range(636):
            row = pixels[(y*1920+left)*4:(y+1)*1920*4]
            twice = b''.join(row[i:i+4]*2 for i in range(0,len(row),4))
            rows.extend([twice,twice])
        png(out/(mode+'-right-2x.png'),b''.join(rows),crop_width*2,1272)
        doc = json.loads((ROOT/('apps/shadow_dash/hud/layouts/dash_shadow_'+mode+'.json')).read_text(encoding='utf-8'))
        canvas = next(w for w in doc['widgets'] if w['type']=='evacanvas')
        for p in canvas['parts']:
            if p['type'] != 'text':
                continue
            font = p['font']
            if font not in fonts:
                fonts[font] = json.loads((ROOT/('apps/eva_hud/hud/fonts/'+font+'.json')).read_text(encoding='utf-8'))
            meta = fonts[font]
            assert not meta.get('preview'), 'synthetic atlas'
            text = p['text']
            for k,v in VALUES.items():
                text = text.replace('{{'+k+'}}',v)
            assert '{{' not in text, text
            assert all(c in meta['glyphs'] for c in text), (font,text,'missing glyph')
            # Check worst-case speed and gear captions too, not just the still.
            samples = [text]
            if p['id']=='spd': samples += ['0','118','199','299']
            if p['id']=='gearcap': samples += ['STANDBY MODE','REVERSE GEAR'] if mode!='eco' else []
            if p['id']=='gearjp': samples += ['待命状態','後退操作']
            if p['id']=='system': samples += ['SYSTEM // 待命状態','SYSTEM // 後退操作']
            for sample in samples:
                width = sum(meta['glyphs'][c]['advance'] for c in sample)
                x = p.get('textX',0)
                if p['align']=='right': x += p['w']-width
                if p['align']=='center': x += round((p['w']-width)/2)
                for c in sample:
                    g = meta['glyphs'][c]
                    if g['w']:
                        assert x+g['ox'] >= 0 and x+g['ox']+g['w'] <= p['w'], (mode,p['id'],sample,'clipped')
                    x += g['advance']
                assert p.get('offsetY',0)+meta['cellHeight'] <= p['h'], (mode,p['id'],'vertical clip')
        print(mode+': PNG + 2x crop; real atlas fit and black y=636..719 verified')


if __name__=='__main__':
    main(sys.argv[1])
