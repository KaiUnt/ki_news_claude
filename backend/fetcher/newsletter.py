"""IMAP-based newsletter fetcher — extracts individual article items per email.

Each marketing newsletter contains multiple curated article links. This fetcher:
  1. Connects via IMAP and fetches UNSEEN emails from configured senders.
  2. Parses the HTML body and extracts individual article links.
  3. Resolves tracking redirect URLs (e.g. IBM Marketing Cloud) to the real URL.
  4. Returns one RawArticle per article item found in the newsletter.

Setup:
  - Create a folder in your mailbox (e.g. "Newsletter") and route newsletters there.
  - Set NEWSLETTER_IMAP_USER, NEWSLETTER_IMAP_PASSWORD in your .env file.
  - Add entries to NEWSLETTER_SOURCES in config.py for each newsletter sender.

Processed emails are marked Seen to avoid reprocessing.
"""
import email
import email.header
import imaplib
import logging
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from ..config import NEWSLETTER_SOURCES, settings
from .base import BaseFetcher, RawArticle

logger = logging.getLogger(__name__)

_DEFAULT_IMAP_HOST = "imap.gmx.net"
_DEFAULT_IMAP_PORT = 993

# Social / infrastructure domains that are never article links
_SKIP_DOMAINS: frozenset[str] = frozenset({
    "twitter.com", "x.com", "facebook.com", "instagram.com",
    "linkedin.com", "youtube.com", "tiktok.com", "pinterest.com",
    "threads.net", "bluesky.social", "mastodon.social",
    "apple.com", "google.com", "microsoft.com",
    "gmx.net", "gmx.at", "gmx.de", "web.de",
    "whatsapp.com", "telegram.org",
})

# Path/query patterns that indicate boilerplate (unsubscribe, view-in-browser, social sharing)
_SKIP_PATH_RE = re.compile(
    r"(unsubscribe|opt.?out|preferences|unsub|manage.?email|email.?settings"
    r"|view.?in.?browser|online.?lesen|im.?browser|forward.?to|weiterleiten"
    r"|share|tweet|teilen|forward.?friend|tell.?friend"
    # IBM Marketing Cloud / Salesforce MCE path segments:
    # /mk/mr/ = view-in-browser mirror, /mk/un/ = unsubscribe, /mk/op/ = open pixel
    r"|/mk/mr/|/mk/un/|/mk/op/)",
    re.IGNORECASE,
)

# Link text that identifies boilerplate CTA buttons — title will be sought nearby
_BOILERPLATE_TEXT_RE = re.compile(
    r"^(read\s+more|mehr\s+(lesen|erfahren)|hier\s+(lesen|klicken)|jetzt\s+lesen"
    r"|weiterlesen|zum\s+artikel|zur\s+meldung|details|more|open|view|click\s+here"
    r"|→|»|▶|🔗|source|quelle|link|\s*)$",
    re.IGNORECASE,
)

# Invisible / tracking characters injected by marketing tools
_INVISIBLE_CHARS_RE = re.compile(r"[­​‌‍﻿​‌‍﻿]")


def _decode_header(value: str) -> str:
    parts = email.header.decode_header(value)
    decoded = []
    for chunk, charset in parts:
        if isinstance(chunk, bytes):
            decoded.append(chunk.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(chunk)
    return "".join(decoded).strip()


def _get_html_body(msg: email.message.Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace")
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace") if payload else ""
    else:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        return payload.decode(charset, errors="replace") if payload else ""
    return ""


def _parse_date(msg: email.message.Message) -> datetime | None:
    date_str = msg.get("Date")
    if not date_str:
        return None
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=None)
    except Exception:
        return None


def _is_content_url(url: str) -> bool:
    """Return True if the URL looks like an actual article rather than boilerplate."""
    if not url or not url.startswith(("http://", "https://")):
        return False
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower().removeprefix("www.")
        # Strip port
        domain = domain.split(":")[0]
        if domain in _SKIP_DOMAINS:
            return False
        if _SKIP_PATH_RE.search(parsed.path + "?" + parsed.query):
            return False
    except Exception:
        return False
    return True


def _find_container(tag, max_levels: int = 5):
    """Walk up the DOM to find the nearest block-level container."""
    node = tag.parent
    for _ in range(max_levels):
        if node is None or node.name in ("body", "html", "[document]"):
            break
        if node.name in ("td", "th", "div", "article", "li", "section", "p", "blockquote"):
            return node
        node = node.parent
    return tag.parent


def _extract_item_title(a_tag) -> str:
    """Find the best title for a link: container heading → link text."""
    container = _find_container(a_tag)
    if container is not None:
        for htag in ("h1", "h2", "h3", "h4", "h5", "strong", "b"):
            heading = container.find(htag)
            if heading:
                t = _INVISIBLE_CHARS_RE.sub("", heading.get_text(strip=True))
                if len(t) > 10:
                    return t

    # Fall back to link text itself
    link_text = _INVISIBLE_CHARS_RE.sub("", a_tag.get_text(strip=True))
    return link_text


def _extract_item_content(a_tag) -> str:
    """Return the text of the nearest block container, stripped of noise."""
    container = _find_container(a_tag)
    if container is None:
        return ""
    # Remove nested links/buttons to avoid duplicate text
    for child in container.find_all("a"):
        child.decompose()
    text = container.get_text(separator=" ", strip=True)
    text = _INVISIBLE_CHARS_RE.sub("", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text[: settings.content_max_chars]


def _extract_newsletter_items(
    soup: BeautifulSoup,
    published_at: datetime | None,
    cfg: dict,
    message_id: str,
) -> list[RawArticle]:
    """Extract individual article items from a newsletter's HTML."""
    articles: list[RawArticle] = []
    seen_urls: set[str] = set()

    for a_tag in soup.find_all("a"):
        if not hasattr(a_tag, "attrs") or a_tag.attrs is None:
            continue
        href = a_tag.get("href") or ""
        if not href.startswith(("http://", "https://")):
            continue

        # Filter boilerplate URLs (unsubscribe, view-in-browser, IBM MCE mirrors)
        if _SKIP_PATH_RE.search(href):
            continue

        if not _is_content_url(href):
            continue
        if href in seen_urls:
            continue
        seen_urls.add(href)

        title = _extract_item_title(a_tag)

        # Skip CTA buttons and boilerplate titles
        if _BOILERPLATE_TEXT_RE.match(title) or len(title) < 10:
            continue

        content = _extract_item_content(a_tag)

        articles.append(
            RawArticle(
                url=href,
                title=title,
                source_name=cfg["name"],
                source_type="newsletter",
                content=content,
                published_at=published_at,
            )
        )

        if len(articles) >= 30:
            break

    if not articles:
        logger.info(
            "[Newsletter] %s: no individual items found — skipping email",
            cfg["name"],
        )
    else:
        logger.info("[Newsletter] %s: extracted %d items", cfg["name"], len(articles))

    return articles


class NewsletterFetcher(BaseFetcher):
    """Fetches newsletters via IMAP and extracts individual article items per email."""

    def __init__(self, sources: list[dict] | None = None):
        self.sources  = sources or NEWSLETTER_SOURCES
        self.host     = settings.newsletter_imap_host or _DEFAULT_IMAP_HOST
        self.port     = settings.newsletter_imap_port or _DEFAULT_IMAP_PORT
        self.user     = settings.newsletter_imap_user
        self.password = settings.newsletter_imap_password
        self.folder   = settings.newsletter_imap_folder

    def fetch(self) -> list[RawArticle]:
        if not self.user or not self.password:
            logger.warning("[Newsletter] NEWSLETTER_IMAP_USER / PASSWORD not set — skipping")
            return []
        if not self.sources:
            return []
        try:
            return self._fetch_from_imap()
        except Exception:
            logger.exception("[Newsletter] IMAP fetch failed")
            return []

    def _fetch_from_imap(self) -> list[RawArticle]:
        articles: list[RawArticle] = []
        sender_map = {cfg["from_email"].lower(): cfg for cfg in self.sources}

        with imaplib.IMAP4_SSL(self.host, self.port) as imap:
            imap.login(self.user, self.password)
            status, _ = imap.select(f'"{self.folder}"')
            if status != "OK":
                logger.error("[Newsletter] Could not select folder '%s'", self.folder)
                return []
            for from_email, cfg in sender_map.items():
                articles.extend(self._fetch_from_sender(imap, from_email, cfg))

        return articles

    def _fetch_from_sender(
        self, imap: imaplib.IMAP4_SSL, from_email: str, cfg: dict
    ) -> list[RawArticle]:
        status, data = imap.search(None, f'(UNSEEN FROM "{from_email}")')
        if status != "OK" or not data[0]:
            return []

        msg_ids = data[0].split()
        logger.info("[Newsletter] %s: %d new email(s)", cfg["name"], len(msg_ids))

        results: list[RawArticle] = []
        for msg_id in msg_ids:
            try:
                items = self._process_message(imap, msg_id, cfg)
                results.extend(items)
                imap.store(msg_id, "+FLAGS", "\\Seen")
            except Exception:
                logger.exception("[Newsletter] Failed to process message %s", msg_id)

        return results

    def _process_message(
        self, imap: imaplib.IMAP4_SSL, msg_id: bytes, cfg: dict
    ) -> list[RawArticle]:
        # BODY.PEEK[] fetches the full message without auto-setting \\Seen
        status, data = imap.fetch(msg_id, "(BODY.PEEK[])")
        if status != "OK":
            return []

        msg = email.message_from_bytes(data[0][1])
        message_id = msg.get("Message-ID", "").strip()
        published_at = _parse_date(msg)
        html = _get_html_body(msg)

        if not html:
            return []

        soup = BeautifulSoup(html, "lxml")
        # Remove style/script noise before parsing
        for tag in soup.find_all(["style", "script", "img", "head"]):
            tag.decompose()

        return _extract_newsletter_items(soup, published_at, cfg, message_id)
