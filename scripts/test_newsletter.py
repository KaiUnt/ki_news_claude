"""Quick smoke-test for the NewsletterFetcher. Run from the project root:

    python -m scripts.test_newsletter
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from backend.fetcher.newsletter import NewsletterFetcher

fetcher = NewsletterFetcher()
print(f"IMAP host : {fetcher.host}:{fetcher.port}")
print(f"User      : {fetcher.user}")
print(f"Folder    : {fetcher.folder}")
print(f"Sources   : {[s['name'] for s in fetcher.sources]}")
print()

articles = fetcher.fetch()

if not articles:
    print("Keine neuen Artikel gefunden (Ordner leer oder keine ungelesenen Mails).")
else:
    for a in articles:
        print(f"[{a.source_name}]")
        print(f"  Titel   : {a.title}")
        print(f"  URL     : {a.url}")
        print(f"  Datum   : {a.published_at}")
        print(f"  Content : {a.content[:200]}...")
        print()
