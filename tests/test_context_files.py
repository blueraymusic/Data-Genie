import base64
import unittest
from unittest.mock import patch
from backend.context_files import validate_files
from backend import gemini_provider
from tests.test_gemini_provider import model_response


def file(mime, data):
    return {'mime_type': mime, 'data': base64.b64encode(data).decode()}


class ContextFilesTests(unittest.TestCase):
    def test_types_signatures_and_budgets(self):
        self.assertEqual(validate_files(None), [])
        for mime, data in [('application/pdf', b'%PDF-1.4'), ('image/png', b'\x89PNG\r\n\x1a\n'), ('image/jpeg', b'\xff\xd8\xff'), ('image/webp', b'RIFFabcdWEBP')]:
            self.assertEqual(validate_files([file(mime, data)]), [file(mime, data)])
        for files in [[file('image/png', b'not png')], [{'mime_type':'image/png','data':'***'}], [file('text/html', b'<script>')], [file('application/pdf', b'%PDF-' + b'a' * (4 * 1024 * 1024))], [file('application/pdf', b'%PDF-')] * 3]:
            with self.assertRaises(ValueError): validate_files(files)

    def test_provider_receives_inline_context_as_data(self):
        attachment = file('application/pdf', b'%PDF-1.4 fixture')
        response = model_response({'status': 'ready', 'clarification': '', 'commands': [{'sql':'SELECT * FROM customers', 'summary':'Show customers.', 'visualization':'table'}]})
        with patch.object(gemini_provider, '_request_json', return_value=response) as provider:
            gemini_provider.generate_plans('show customers', [{'name':'customers','columns':[]}], 'test','test', attachments=[attachment])
        payload = provider.call_args.args[2]
        self.assertIn({'inlineData': {'mimeType':'application/pdf','data':attachment['data']}}, payload['contents'][-1]['parts'])
        self.assertNotIn(attachment['data'], str(payload['systemInstruction']))
