"""Bounded inline context; files are neither executed nor stored in history."""
import base64
import binascii

def validate_files(files):
    if files is None:
        return []
    if not isinstance(files, list) or len(files) > 2:
        raise ValueError('Attach at most two PDF or image files.')
    result, size = [], 0
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get('data'), str) or len(item['data']) > 6 * 1024 * 1024:
            raise ValueError('Invalid attachment.')
        try:
            data = base64.b64decode(item['data'], validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('Invalid attachment encoding.') from None
        mime = item.get('mime_type')
        valid = ((mime == 'application/pdf' and data.startswith(b'%PDF-'))
                 or (mime == 'image/png' and data.startswith(b'\x89PNG\r\n\x1a\n'))
                 or (mime == 'image/jpeg' and data.startswith(b'\xff\xd8\xff'))
                 or (mime == 'image/webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP'))
        size += len(data)
        if not valid or not data or size > 4 * 1024 * 1024:
            raise ValueError('Use PDF, PNG, JPEG or WebP files, up to 4 MB combined.')
        result.append({'mime_type': mime, 'data': item['data']})
    return result
