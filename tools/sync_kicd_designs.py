#!/usr/bin/env python3
"""Discover official KICD curriculum-design PDFs and extract reviewable text. Conservative by design: it never marks curriculum rows verified. PDF table extraction is inconsistent, so it saves full extracted text and a source inventory for review. """
from __future__ import annotations
import csv, io, re, sys, time
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'curriculum-review-pack'
INDEX = 'https://kicd.ac.ke/cbc-materials/curriculum-designs/regular-curriculum-designs/'
SNE = 'https://kicd.ac.ke/cbc-materials/curriculum-designs/sne-curriculum-designs/'
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': 'TPAD-Curriculum-Research-Helper/1.0 (educational use; respects public KICD pages)'})

GRADE_RE = re.compile(r'\b(grade\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})|lower\s*primary|pre[- ]?primary|pp1|pp2)\b', re.I)

def get(url):
    r = SESSION.get(url, timeout=35)
    r.raise_for_status()
    return r

def same_official_domain(url):
    host = (urlparse(url).hostname or '').lower()
    return host == 'kicd.ac.ke' or host.endswith('.kicd.ac.ke')

def grade_page_links(index_url):
    soup = BeautifulSoup(get(index_url).text, 'html.parser')
    links = {}
    for a in soup.find_all('a', href=True):
        text = ' '.join(a.get_text(' ', strip=True).split())
        href = urljoin(index_url, a['href'])
        if not same_official_domain(href):
            continue
        match = GRADE_RE.search(text)
        if match and ('design' in text.lower() or 'design' in href.lower() or 'grade' in href.lower()):
            links[href] = text or href
    # The main index is authoritative even if a theme hides button labels from parsing.
    links[index_url] = 'Regular curriculum designs index'
    return links

def pdf_links(page_url):
    soup = BeautifulSoup(get(page_url).text, 'html.parser')
    found = {}
    for a in soup.find_all('a', href=True):
        href = urljoin(page_url, a['href'])
        if not same_official_domain(href):
            continue
        label = ' '.join(a.get_text(' ', strip=True).split()) or Path(urlparse(href).path).name
        if '.pdf' in urlparse(href).path.lower() or 'download' in href.lower():
            found[href] = label
    return found

def guess_grade(text):
    t = text.lower()
    for n, word in [(1,'one'),(2,'two'),(3,'three'),(4,'four'),(5,'five'),(6,'six'),(7,'seven'),(8,'eight'),(9,'nine'),(10,'ten'),(11,'eleven'),(12,'twelve')]:
        if re.search(rf'grade\s*{n}\b', t) or re.search(rf'grade\s*{word}\b', t):
            return f'Grade {n}'
    if 'lower primary' in t or 'grade 1-3' in t: return 'Grades 1–3'
    if 'pre-primary' in t or 'pp1' in t or 'pp2' in t: return 'Pre-Primary'
    return 'Unknown grade — review source'

def guess_level(grade, title=''):
    if 'Special Needs' in title or 'SNE' in title.upper(): return 'Special Needs Education'
    if grade.startswith('Grade '):
        try: n = int(grade.split()[1])
        except ValueError: n = 0
        if 1 <= n <= 6: return 'Primary School'
        if 7 <= n <= 9: return 'Junior School'
        if 10 <= n <= 12: return 'Senior School'
    if grade == 'Grades 1–3': return 'Primary School'
    return 'Primary School'

def safe_filename(s):
    s = re.sub(r'[^a-zA-Z0-9._-]+', '_', s).strip('._')
    return (s[:110] or 'curriculum_design')

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    text_dir = OUT / 'extracted-text'
    text_dir.mkdir(exist_ok=True)
    print('Discovering official KICD design pages…')
    pages = grade_page_links(INDEX)
    # Try the official SNE page too; failure does not stop regular-design discovery.
    try:
        pages.update(grade_page_links(SNE))
    except Exception as e:
        print(f'Note: SNE index could not be read ({e}); regular designs will continue.')
    sources = {}
    for page_url, page_title in list(pages.items()):
        try:
            for pdf_url, label in pdf_links(page_url).items():
                sources[pdf_url] = {'page_title': page_title, 'label': label, 'page_url': page_url}
        except Exception as e:
            print(f'Skipping page {page_url}: {e}')
    # Index pages sometimes link to a WordPress download landing page rather than the PDF.
    print(f'Found {len(sources)} possible official design/download links before resolving download pages.')
    manifest = []
    queue = list(sources.items())
    processed = set()
    i = 0
    while i < len(queue):
        pdf_url, info = queue[i]
        i += 1
        if pdf_url in processed:
            continue
        processed.add(pdf_url)
        title = info['label'] or Path(urlparse(pdf_url).path).name
        print(f'[{i}/{len(sources)}] {title}')
        row = {'source_title': title, 'source_url': pdf_url, 'index_page_url': info['page_url'], 'download_status': 'not downloaded', 'grade_guess': guess_grade(title + ' ' + pdf_url), 'school_level_guess': '', 'pages_extracted': 0, 'text_file': '', 'review_status': 'UNVERIFIED — human check required'}
        try:
            resp = get(pdf_url)
            content_type = resp.headers.get('content-type', '').lower()
            data = resp.content
            if not (data[:4] == b'%PDF' or 'pdf' in content_type):
                # If this is a landing page, harvest direct PDFs from it and move on.
                try:
                    for direct_url, direct_label in pdf_links(pdf_url).items():
                        if direct_url != pdf_url and direct_url not in processed and direct_url not in dict(queue):
                            queue.append((direct_url, {'page_title': title, 'label': direct_label, 'page_url': pdf_url}))
                except Exception:
                    pass
                row['download_status'] = 'not a direct PDF; discovered landing page'
                manifest.append(row)
                continue
            reader = PdfReader(io.BytesIO(data))
            pages_text = []
            for pno, page in enumerate(reader.pages, 1):
                try: txt = page.extract_text() or ''
                except Exception: txt = ''
                pages_text.append(f'\n\n===== PAGE {pno} =====\n{txt}')
            full = '\n'.join(pages_text)
            filename = safe_filename(title) + '.txt'
            (text_dir / filename).write_text(f'SOURCE TITLE: {title}\nSOURCE URL: {pdf_url}\nINDEX PAGE: {info["page_url"]}\n\n{full}', encoding='utf-8')
            row.update(download_status='PDF extracted', pages_extracted=len(reader.pages), text_file=f'extracted-text/{filename}')
            row['grade_guess'] = guess_grade(title + ' ' + pdf_url + ' ' + full[:2500])
            row['school_level_guess'] = guess_level(row['grade_guess'], title)
        except Exception as e:
            row['download_status'] = 'failed: ' + str(e)[:220]
        manifest.append(row)
        time.sleep(0.2)
    manifest_path = OUT / 'source-manifest.csv'
    with manifest_path.open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=list(manifest[0].keys()) if manifest else ['source_title','source_url','index_page_url','download_status','grade_guess','school_level_guess','pages_extracted','text_file','review_status'])
        w.writeheader(); w.writerows(manifest)
    # Template is copied so reviewed records can be prepared without guessing.
    template = ROOT / 'tpad' / 'curriculum-template.csv'
    if template.exists():
        (OUT / 'curriculum-template.csv').write_bytes(template.read_bytes())
    summary = [
        'KICD CURRICULUM REVIEW PACK',
        'Source indexes:', INDEX, SNE,
        '', f'Links discovered: {len(sources)}', f'Manifest rows: {len(manifest)}',
        f'PDFs extracted: {sum(1 for r in manifest if r["download_status"] == "PDF extracted")}',
        '', 'IMPORTANT: No rows are automatically marked verified.',
        'PDF table extraction can reorder columns or omit layout. Use the extracted text only as a navigation aid.',
        'A human must compare each imported strand, sub-strand, outcome and guidance field to the original official PDF.',
        'Only after review should a curriculum_items CSV row be marked is_verified=true, with reviewer and date.'
    ]
    (OUT / 'README-review.txt').write_text('\n'.join(summary), encoding='utf-8')
    print(f'Finished. Review pack: {OUT}')
    print(f'Manifest: {manifest_path}')
    print('All discovered records remain unverified until checked against the original KICD design.')

if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: print('Stopped by user.', file=sys.stderr)
