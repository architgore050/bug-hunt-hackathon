"""Offline helper: read the length-prefixed LSB payload from campus.png."""
from PIL import Image
img = Image.open("campus.png")
bits = []
for y in range(img.height):
    for x in range(img.width):
        bits.append(img.getpixel((x, y))[0] & 1)
        if len(bits) >= 8 * (1 + 32):  # length byte + longest plausible payload
            break
    if len(bits) >= 8 * 33:
        break
def to_bytes(bitlist, n):
    out = bytearray()
    for i in range(n):
        byte = 0
        for bit in bitlist[i * 8:(i + 1) * 8]:
            byte = (byte << 1) | bit
        out.append(byte)
    return bytes(out)
length = to_bytes(bits, 1)[0]
print(to_bytes(bits[8:], length).decode(errors='replace'))
