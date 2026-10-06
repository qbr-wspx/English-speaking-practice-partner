"""Package generated texture assets in a new VRoid project, preserving other fields."""
from pathlib import Path
import zipfile
from inspect_vroid import fields

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / 'output/character-3d/textures'
SOURCE = ROOT / 'output/character-3d/A-companion-base.vroid'
DEST = ROOT / 'output/character-3d/A-companion-styled.vroid'
REPLACEMENTS = {
    (TEX / 'source/texture-02.png').read_bytes(): (TEX / 'coat-white-blue.png').read_bytes(),
    (TEX / 'source/texture-30.png').read_bytes(): (TEX / 'skirt-navy.png').read_bytes(),
    (TEX / 'source/texture-26.png').read_bytes(): (TEX / 'hair-matte.png').read_bytes(),
    (TEX / 'source/texture-00.png').read_bytes(): (TEX / 'hair-matte.png').read_bytes(),
}
count = 0

def encode(n):
    out = bytearray()
    while n > 127:
        out.append((n & 127) | 128)
        n >>= 7
    out.append(n)
    return bytes(out)

def replace(b, depth=0):
    global count
    if b in REPLACEMENTS:
        count += 1
        return REPLACEMENTS[b]
    if depth > 25 or b.startswith(b'\x89PNG'):
        return b
    try:
        items = fields(b)
    except ValueError:
        return b
    result = []
    for number, wire, value, original in items:
        if wire != 2:
            result.append(original)
            continue
        changed = replace(value, depth+1)
        result.append(original if changed == value else encode((number << 3) | 2) + encode(len(changed)) + changed)
    return b''.join(result)

assert not DEST.exists(), 'Preserve existing project; use a new destination'
with zipfile.ZipFile(SOURCE) as src, zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as dst:
    for entry in src.infolist():
        b = src.read(entry.filename)
        if entry.filename == 'v1model/data.bin':
            b = replace(b)
            fields(b)
        dst.writestr(entry, b)
assert count == 4, f'Expected four texture replacements, got {count}'
print(f'Created {DEST.name}; replaced {count} texture assets')
