#!/usr/bin/env python3
"""Copy sources/sources.json to site/data/sources.json (the Sources page renders it) and check URL formats.
Run: python3 -I scripts/65_sources_site.py   (standard library only; does not open any URL)"""
import json, os, re, shutil
from urllib.parse import urlparse
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src, dst = os.path.join(R, 'sources/sources.json'), os.path.join(R, 'site/data/sources.json')
d = json.load(open(src, encoding='utf-8'))
shutil.copyfile(src, dst)
bad = 0
for x in d['datasets']:
    for u in re.findall(r'https?://[^\s)\'"]+', x['url'] + ' ' + x['citation'] + ' ' + x['licence_or_terms']):
        u = u.rstrip('.,;')
        p = urlparse(u)
        tmpl = any(c in u for c in '<>{}')
        ok = bool(p.scheme in ('http', 'https') and p.netloc and '.' in p.netloc)
        if not ok: bad += 1
        print(('ok  ' if ok else 'BAD ') + ('(template) ' if tmpl else '') + x['id'] + ' ' + u)
print(len(d['datasets']), 'datasets copied;', bad, 'bad URLs')
