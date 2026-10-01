"""Offline check: the file-fallback token store is 0600 from creation, and the
upload filename cannot break out of the multipart header."""
import importlib.util, json, os, pathlib, stat, tempfile

spec = importlib.util.spec_from_file_location('aa', pathlib.Path(__file__).with_name('add_applicant.py'))
aa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aa)

d = pathlib.Path(tempfile.mkdtemp())
aa.TOKEN_FILE = d / 'sub' / 'tokens.json'
aa.keychain_save = lambda service, value: False  # force the file path
os.umask(0o022)
for pair in (('a1', 'r1'), ('a2', 'r2')):  # second write replaces the first
    aa.save_tokens(*pair)
    assert stat.S_IMODE(aa.TOKEN_FILE.stat().st_mode) == 0o600
assert json.loads(aa.TOKEN_FILE.read_text()) == {'access_token': 'a2', 'refresh_token': 'r2'}

sent = {}
aa.api = lambda path, **kw: sent.update(body=kw['body'])
evil = d / 'a"b\r\nX.pdf'
evil.write_bytes(b'x')
aa.upload_cv(1, str(evil))
assert sent['body'].split(b'\r\n')[1] == b'Content-Disposition: form-data; name="file"; filename="a_b__X.pdf"'
