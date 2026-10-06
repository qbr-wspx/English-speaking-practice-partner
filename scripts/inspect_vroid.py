"""Inspect length-delimited VRoid protobuf assets without changing the source."""
import sys
import zipfile
import struct

def varint(b, pos):
    value = 0
    for shift in range(0, 70, 7):
        if pos >= len(b):
            raise ValueError('Truncated varint')
        byte = b[pos]
        pos += 1
        value |= (byte & 127) << shift
        if byte < 128:
            return value, pos
    raise ValueError('Invalid varint')

def fields(b):
    result = []
    pos = 0
    while pos < len(b):
        start = pos
        tag, pos = varint(b, pos)
        number, wire = tag >> 3, tag & 7
        if not number or number > 10000:
            raise ValueError('Not a message')
        if wire == 0:
            value, pos = varint(b, pos)
        elif wire in (1, 5):
            end = pos + (8 if wire == 1 else 4)
            if end > len(b):
                raise ValueError('Truncated fixed field')
            value, pos = b[pos:end], end
        elif wire == 2:
            length, pos = varint(b, pos)
            end = pos + length
            if end > len(b):
                raise ValueError('Truncated bytes')
            value, pos = b[pos:end], end
        else:
            raise ValueError('Unsupported wire')
        result.append((number, wire, value, b[start:pos]))
    return result

def walk(b, path='root', depth=0):
    if depth > 25:
        return
    try:
        items = fields(b)
    except ValueError:
        return
    for i, (number, wire, value, _) in enumerate(items):
        here = f'{path}/{number}[{i}]'
        if wire == 2:
            if value.startswith(b'\x89PNG'):
                print(here, 'PNG', len(value), struct.unpack('>II',value[16:24]))
                continue
            try:
                txt = value.decode('utf8')
                if txt and all(c.isprintable() for c in txt):
                    if '--all' in sys.argv or any(k in txt.lower() for k in ('parameter','color','iris','highlight','hair','recipe','layer','coat','eye')):
                        print(here, repr(txt[:180]))
                    continue
            except UnicodeError:
                pass
            walk(value, here, depth+1)

if __name__ == '__main__':
    walk(zipfile.ZipFile(sys.argv[1]).read('v1model/data.bin'))
