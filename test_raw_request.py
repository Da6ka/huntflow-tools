#!/usr/bin/env python3
"""
Tests for raw_request() body encoding. Offline — urlopen is stubbed, so
no token or network is needed.

Run directly (python3 test_raw_request.py) or via smoke_test.sh.
"""

import json, unittest, urllib.request

import add_applicant


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def read(self):
        return b'{}'


class BodyEncodingTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        real_urlopen = urllib.request.urlopen
        urllib.request.urlopen = lambda req, timeout=None: (
            self.sent.append(req) or FakeResponse()
        )
        self.addCleanup(setattr, urllib.request, 'urlopen', real_urlopen)

    def send(self, **kwargs):
        add_applicant.raw_request('/vacancies/1', method='PATCH', use_auth=False, **kwargs)
        return self.sent[-1]

    def test_str_body_is_encoded(self):
        # Regression: a str body used to be dropped, sending an empty request
        # that still carried Content-Type: application/json. The API answered
        # 400 value_error.missing, which reads as a schema problem instead.
        payload = {'fill_quotas': [{'deadline': '2026-08-01'}]}
        req = self.send(body=json.dumps(payload))
        self.assertEqual(json.loads(req.data), payload)
        self.assertEqual(req.headers['Content-type'], 'application/json')

    def test_str_and_dict_bodies_are_identical(self):
        payload = {'fill_quotas': [{'deadline': '2026-08-01'}]}
        self.assertEqual(self.send(body=json.dumps(payload)).data,
                         self.send(body=payload).data)

    def test_bytes_body_is_passed_through(self):
        # The upload_cv() multipart path.
        body = b'--boundary\r\nbytes'
        req = self.send(body=body, content_type='multipart/form-data; boundary=x')
        self.assertEqual(req.data, body)
        self.assertEqual(req.headers['Content-type'], 'multipart/form-data; boundary=x')

    def test_no_body_sends_no_content_type(self):
        req = self.send()
        self.assertIsNone(req.data)
        self.assertIsNone(req.headers.get('Content-type'))

    def test_unsupported_body_type_raises(self):
        with self.assertRaises(TypeError) as ctx:
            self.send(body=42)
        self.assertIn('int', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
