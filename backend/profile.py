"""Bounded profile pictures stored with the account, never remote image URLs."""

import base64
import binascii

PHOTO_PREFIX = "data:image/jpeg;base64,"
MAX_PHOTO_BYTES = 100 * 1024


def profile_photo(value):
    if value is None:
        return None
    message = "Choose a PNG, JPEG or WebP photo using the photo picker."
    if (not isinstance(value, str) or not value.startswith(PHOTO_PREFIX)
            or len(value) > len(PHOTO_PREFIX) + ((MAX_PHOTO_BYTES + 2) // 3) * 4):
        raise ValueError(message)
    try:
        data = base64.b64decode(value[len(PHOTO_PREFIX):], validate=True)
    except (binascii.Error, ValueError):
        raise ValueError(message) from None
    if not 32 <= len(data) <= MAX_PHOTO_BYTES or data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
        raise ValueError(message)
    # Check the JPEG frame before letting the browser decode it. The picker
    # resizes to 192px and strips metadata; direct requests stay bounded too.
    position = 2
    while position + 4 <= len(data):
        if data[position] != 255:
            break
        position += 1
        while position < len(data) and data[position] == 255:
            position += 1
        if position + 3 > len(data):
            break
        marker = data[position]
        position += 1
        length = int.from_bytes(data[position:position + 2], "big")
        if length < 2 or position + length > len(data):
            break
        if marker in (0xC0, 0xC1, 0xC2):
            frame = data[position:position + length]
            height, width = int.from_bytes(frame[3:5], "big"), int.from_bytes(frame[5:7], "big")
            if len(frame) >= 8 and frame[2] == 8 and 1 <= width <= 256 and 1 <= height <= 256:
                return PHOTO_PREFIX + base64.b64encode(data).decode("ascii")
            break
        if marker in (0xDA, 0xD9):
            break
        position += length
    raise ValueError(message)
