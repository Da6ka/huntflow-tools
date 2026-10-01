#!/usr/bin/env python3
"""
Add a new applicant to Huntflow with CV upload and link to a vacancy.

Usage:
  python3 add_applicant.py --cv path/to/cv.pdf --vacancy-id 100001 --status-id 200001 [options]

Options:
  --cv PATH                 Path to CV file (PDF/DOC/DOCX/RTF). Required.
  --vacancy-id INT          Vacancy ID to link the applicant to. Required.
  --status-id INT           Pipeline status ID for the link. Required.
  --comment TEXT            Comment for the vacancy link. Optional.
  --first-name TEXT         Override parsed first name.
  --last-name TEXT          Override parsed last name.
  --email TEXT              Override parsed email.
  --phone TEXT              Override parsed phone.
  --position TEXT           Position label. Defaults to parsed value.
  --money TEXT              Salary expectation string (e.g. "2400 EUR/mo").
  --source-id INT           After linking, set the applicant source (e.g. a «company site» source id). Keeps the CV.
  --tag-id INT              Tag id, repeatable. New applicant only: the POST replaces the whole set.
  --linkedin URL            Questionary LinkedIn.
  --github URL              Questionary GitHub.
  --telegram HANDLE         Telegram handle ("name", "@name" or a t.me link); stored in the applicant's social list.
  --location TEXT           Questionary Location.
  --email2 TEXT             Questionary "2nd Email" (a 3rd+ address goes into --comment).
  --no-link-files           Do not attach the CV to the vacancy link (site-application rule).
  --dry-run                 Parse CV and print the body, don't POST.

Reads:
  HUNTFLOW_ACCOUNT_ID env (required)
  Tokens from macOS Keychain (huntflow-access-token / huntflow-refresh-token, account "huntflow")
  OR ~/.huntflow/tokens.json with {"access_token": "...", "refresh_token": "..."}
"""

import argparse, json, os, re, subprocess, sys, urllib.request, urllib.error, uuid, mimetypes
from pathlib import Path

API_BASE = 'https://api.huntflow.ru/v2'
TOKEN_FILE = Path.home() / '.huntflow' / 'tokens.json'
TIMEOUT = int(os.environ.get('HUNTFLOW_TIMEOUT') or 30)

EMAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
# A phone-shaped run: optional +, then digits/space/dash/dot/parens, ending in a digit.
PHONE_RE = re.compile(r'\+?\d[\d()\-.\s]{6,}\d')
PHONE_LABEL_RE = re.compile(r'(?i)\b(phone|mobile|mob|tel|telephone|cell|whatsapp)\b')


KNOWN_TLDS = {'com', 'org', 'net', 'io', 'ru', 'co', 'uk', 'edu', 'gov', 'me',
              'dev', 'app', 'info', 'biz', 'us', 'ca', 'de', 'fr', 'nl', 'eu', 'tech'}


def first_email(text):
    text = text or ''
    m = EMAIL_RE.search(text)
    if not m:
        return None
    email = m.group(0)
    # PDF extraction sometimes wraps an email's TLD onto the next line ("gmail.co\nm").
    # Repair it only when a 1-2 letter orphan immediately follows and completes a known
    # TLD — so a full trailing word ("gmail.com\nPortfolio") is never swallowed.
    frag = re.match(r'[ \t]*\n[ \t]*([A-Za-z]{1,2})\b', text[m.end():])
    if frag and (email.rsplit('.', 1)[-1] + frag.group(1)).lower() in KNOWN_TLDS:
        email += frag.group(1)
    return email


def first_phone(text):
    """Best-effort phone from CV text. Collects phone-shaped tokens with at least 9
    digits (which excludes year ranges like "2024 - 2024") and prefers one on a line
    that names a phone. Recovered numbers are worth eyeballing against the CV."""
    if not text:
        return None
    candidates = []
    for line in text.splitlines():
        labelled = bool(PHONE_LABEL_RE.search(line))
        for m in PHONE_RE.finditer(line):
            tok = m.group(0).strip()
            if len(re.sub(r'\D', '', tok)) >= 9:
                candidates.append((labelled, tok))
    candidates.sort(key=lambda c: not c[0])  # labelled lines first
    return candidates[0][1] if candidates else None


TG_HANDLE_RE = re.compile(r'^[A-Za-z0-9_]{5,32}$')


def tg_handle(value):
    """Normalise "@name", "name" or "https://t.me/name" to the bare handle, or None when
    it is not a valid Telegram username (so a handle split by a space is refused, not guessed)."""
    if not value:
        return None
    v = re.sub(r'^(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/', '', value.strip(), flags=re.I)
    v = v.lstrip('@').rstrip('/')
    return v if TG_HANDLE_RE.match(v) else None


def keychain_get(service):
    if sys.platform != 'darwin':
        return None
    try:
        return subprocess.check_output(
            ['security', 'find-generic-password', '-s', service, '-a', 'huntflow', '-w'],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
    except subprocess.CalledProcessError:
        return None


def keychain_save(service, value):
    if sys.platform != 'darwin':
        return False
    try:
        subprocess.run(
            ['security', 'add-generic-password', '-s', service, '-a', 'huntflow', '-w', value, '-U'],
            check=True, stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def file_tokens():
    if TOKEN_FILE.exists():
        return json.loads(TOKEN_FILE.read_text())
    return {}


def get_token(kind):
    """kind: 'access' or 'refresh'"""
    return keychain_get(f'huntflow-{kind}-token') or file_tokens().get(f'{kind}_token')


def save_tokens(access, refresh):
    saved_access = keychain_save('huntflow-access-token', access)
    saved_refresh = keychain_save('huntflow-refresh-token', refresh)
    if not (saved_access and saved_refresh):
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file then rename, so a crash mid-write can't leave a
        # truncated/corrupt tokens.json and lock us out.
        tmp = TOKEN_FILE.with_suffix('.json.tmp')
        # Create with 0600 up front; write_text then chmod leaves a window where
        # the tokens are readable under the default umask.
        tmp.unlink(missing_ok=True)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'access_token': access, 'refresh_token': refresh}, f, indent=2)
        tmp.replace(TOKEN_FILE)


def raw_request(path, method='GET', body=None, content_type='application/json', use_auth=True, extra_headers=None, token_override=None):
    headers = {}
    if extra_headers:
        headers.update(extra_headers)
    if use_auth:
        token = token_override or get_token('access')
        if not token:
            sys.exit('No access token. Set keychain or ~/.huntflow/tokens.json')
        headers['Authorization'] = f'Bearer {token}'
    if body is not None and content_type:
        headers['Content-Type'] = content_type

    data = None
    if isinstance(body, (dict, list)):
        data = json.dumps(body).encode()
    elif isinstance(body, str):
        data = body.encode()
    elif isinstance(body, (bytes, bytearray)):
        data = body
    elif body is not None:
        raise TypeError(f'Unsupported body type: {type(body).__name__}')

    req = urllib.request.Request(f'{API_BASE}{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read() or 'null')
    except urllib.error.HTTPError as e:
        return ('__error__', e.code, e.read().decode())
    except urllib.error.URLError as e:
        sys.exit(f'Network error contacting {API_BASE}: {e.reason}')


def refresh_tokens():
    refresh = get_token('refresh')
    if not refresh:
        sys.exit('No refresh token. Set keychain or ~/.huntflow/tokens.json')
    body = {'refresh_token': refresh}
    result = raw_request('/token/refresh', method='POST', body=body, use_auth=False)
    if isinstance(result, tuple):
        print(f'Token refresh failed: {result[2]}', file=sys.stderr)
        sys.exit(2)  # 2 = auth/token failure
    save_tokens(result['access_token'], result['refresh_token'])
    return result['access_token']


def api(path, method='GET', body=None, content_type='application/json', extra_headers=None):
    result = raw_request(path, method, body, content_type, extra_headers=extra_headers)
    # Auto-refresh only on 401. Huntflow returns 401 for a recognized-but-expired
    # token (the normal refresh trigger). A malformed/corrupt token is unknown to
    # the server and comes back as 404 instead — that does NOT self-heal here, it
    # just surfaces the error. Atomic token writes (save_tokens) are what keep a
    # partial write from ever leaving such a corrupt token behind.
    if isinstance(result, tuple) and result[1] == 401:
        # Use the freshly issued token directly; re-reading storage can return a
        # stale Keychain value if the write fell back to the token file.
        new_token = refresh_tokens()
        result = raw_request(path, method, body, content_type, extra_headers=extra_headers, token_override=new_token)
    if isinstance(result, tuple):
        if 'error.robot_token.not_found' in result[2]:
            # 2 = auth/token failure, distinct from generic errors
            print('Huntflow token is invalid or expired. Regenerate your API token in Huntflow, then run setup.sh to store the new pair.', file=sys.stderr)
            sys.exit(2)
        print(f'HTTP {result[1]}: {result[2]}', file=sys.stderr)
        sys.exit(1)
    return result


def upload_cv(account_id, cv_path):
    cv_bytes = Path(cv_path).read_bytes()
    boundary = '----' + uuid.uuid4().hex
    filename = Path(cv_path).name.replace('"', '_').replace('\r', '_').replace('\n', '_')
    ctype = mimetypes.guess_type(cv_path)[0] or 'application/octet-stream'
    body = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f'Content-Type: {ctype}\r\n\r\n'
    ).encode() + cv_bytes + f'\r\n--{boundary}--\r\n'.encode()
    return api(
        f'/accounts/{account_id}/upload',
        method='POST',
        body=body,
        content_type=f'multipart/form-data; boundary={boundary}',
        extra_headers={'X-File-Parse': 'true'},
    )


def main():
    ap = argparse.ArgumentParser(description='Add applicant to Huntflow')
    ap.add_argument('--cv', required=True, help='Path to CV file')
    ap.add_argument('--vacancy-id', type=int, required=True)
    ap.add_argument('--status-id', type=int, required=True)
    ap.add_argument('--comment', default='')
    ap.add_argument('--first-name')
    ap.add_argument('--last-name')
    ap.add_argument('--email')
    ap.add_argument('--phone')
    ap.add_argument('--position')
    ap.add_argument('--money')
    ap.add_argument('--source-id', type=int)
    ap.add_argument('--tag-id', type=int, action='append', default=[])
    ap.add_argument('--linkedin')
    ap.add_argument('--github')
    ap.add_argument('--telegram')
    ap.add_argument('--location')
    ap.add_argument('--email2')
    ap.add_argument('--no-link-files', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    telegram = tg_handle(args.telegram)
    if args.telegram and not telegram:
        sys.exit(f'ERROR: --telegram {args.telegram!r} is not a valid Telegram username '
                 '(5-32 letters, digits or underscores, no spaces). Check the CV and pass the real handle.')

    account_id = os.environ.get('HUNTFLOW_ACCOUNT_ID')
    if not account_id:
        sys.exit('HUNTFLOW_ACCOUNT_ID env var is not set')
    account_id = int(account_id)

    if not Path(args.cv).exists():
        sys.exit(f'CV file not found: {args.cv}')

    print(f'1. Uploading CV {args.cv}...')
    upload = upload_cv(account_id, args.cv)
    file_id = upload.get('id')
    fields = upload.get('fields') or {}
    name = fields.get('name') or {}
    text = upload.get('text') or ''
    print(f'   File ID: {file_id}')
    print(f'   Parsed name: {name}')

    # Huntflow's CV parser often returns an empty name/email/phone even when the
    # extracted text plainly contains them. Fall back to scanning the text so a parse
    # miss doesn't silently create an "Unknown" applicant with no way to reach them.
    first_name = args.first_name or name.get('first')
    last_name = args.last_name or name.get('last')
    email = args.email or (fields.get('emails') or [None])[0] or first_email(text)
    phone = args.phone or (fields.get('phones') or [None])[0] or first_phone(text)
    print(f'   Contacts: email={email or "(none)"}  phone={phone or "(none)"}')

    # A nameless record is worse than none: it clutters the ATS and is hard to find
    # again. Refuse rather than writing "Unknown" — the name is the one field that
    # can't be recovered from free text, so make the human supply it.
    if not (first_name and last_name):
        sys.exit(
            'ERROR: could not determine the applicant name — Huntflow parsed none and '
            'it cannot be recovered from the CV text.\nRe-run with --first-name and '
            '--last-name (and check the parsed --email/--phone above against the CV).'
        )

    # Huntflow's parser sometimes returns birthdate as a dict (or empty), which the
    # applicants API rejects with a 400 (expects date/string/int/float). Only forward
    # a scalar value; drop anything else so a bad parse can't block the create.
    birthday = fields.get('birthdate')
    if not isinstance(birthday, (str, int, float)):
        birthday = None

    applicant_body = {
        'first_name': first_name,
        'last_name': last_name,
        'middle_name': name.get('middle'),
        'phone': phone,
        'email': email,
        'position': args.position or fields.get('position'),
        'company': (fields.get('experience') or [{}])[0].get('company') if fields.get('experience') else None,
        'money': args.money,
        'birthday': birthday,
        'social': [{'social_type': 'TELEGRAM', 'value': telegram}] if telegram else None,
        'photo': (upload.get('photo') or {}).get('id'),
        'externals': [{
            'data': {'body': text},
            'auth_type': 'NATIVE',
            'files': [file_id],
        }],
    }
    applicant_body = {k: v for k, v in applicant_body.items() if v is not None}

    if args.dry_run:
        print('\n--- DRY RUN ---')
        print(json.dumps(applicant_body, indent=2, ensure_ascii=False))
        return

    print(f'\n2. Creating applicant...')
    applicant = api(f'/accounts/{account_id}/applicants', method='POST', body=applicant_body)
    aid = applicant['id']
    print(f'   Applicant ID: {aid}')

    print(f'\n3. Linking to vacancy {args.vacancy_id} at status {args.status_id}...')
    link_body = {
        'vacancy': args.vacancy_id,
        'status': args.status_id,
        'comment': args.comment,
        'files': [] if args.no_link_files else [file_id],
    }
    link = api(f'/accounts/{account_id}/applicants/{aid}/vacancy', method='POST', body=link_body)
    print(f'   Link ID: {link.get("id")}')

    if args.tag_id:
        print(f'\n4. Tags {args.tag_id}...')
        api(f'/accounts/{account_id}/applicants/{aid}/tags', method='POST', body={'tags': args.tag_id})

    if args.source_id:
        print(f'\n5. Source {args.source_id} (CV kept via files)...')
        full = api(f'/accounts/{account_id}/applicants/{aid}')
        eid = full['external'][0]['id']
        api(f'/accounts/{account_id}/applicants/{aid}/externals/{eid}', method='PUT',
            body={'account_source': args.source_id, 'data': {'body': text}, 'files': [file_id]})

    # Questionary keys are opaque and per-account: resolve them by field title.
    wanted = {'linkedin': args.linkedin, 'github': args.github,
              'location': args.location, '2nd email': args.email2}
    if any(wanted.values()):
        print('\n6. Questionary fields...')
        schema = api(f'/accounts/{account_id}/applicants/questionary') or {}
        by_title = {f.get('title', '').lower(): k for k, f in schema.items() if isinstance(f, dict)}
        quest = {by_title[t]: v for t, v in wanted.items() if v and t in by_title}
        missing = [t for t, v in wanted.items() if v and t not in by_title]
        if missing:
            print(f'   skipped (no such questionary field in this account): {", ".join(missing)}')
        if quest:
            api(f'/accounts/{account_id}/applicants/{aid}/questionary', method='POST', body=quest)

    print(f'\nDONE. Applicant {aid} linked to vacancy {args.vacancy_id}')


if __name__ == '__main__':
    main()
