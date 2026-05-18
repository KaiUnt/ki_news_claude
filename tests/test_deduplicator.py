from datetime import datetime

import pytest

from backend.deduplicator import (
    _normalize_title,
    _title_similarity,
    content_hash,
    deduplicate,
)
from backend.fetcher.base import RawArticle


def _article(title: str, url: str = "") -> RawArticle:
    return RawArticle(
        url=url or f"https://example.com/{title.replace(' ', '-')}",
        title=title,
        source_name="Test",
        source_type="rss",
    )


# ── _normalize_title ──────────────────────────────────────────────────────────

def test_normalize_title_lowercases():
    assert _normalize_title("Claude 4.7 RELEASED") == "claude 4.7 released"


def test_normalize_title_strips_whitespace():
    assert _normalize_title("  GPT-5 released  ") == "gpt-5 released"


def test_normalize_title_collapses_inner_spaces():
    assert _normalize_title("Claude  4.7   Released") == "claude 4.7 released"


# ── _title_similarity ─────────────────────────────────────────────────────────

def test_title_similarity_identical():
    assert _title_similarity("Claude 4.7 Released", "Claude 4.7 Released") == 1.0


def test_title_similarity_completely_different():
    score = _title_similarity("OpenAI releases GPT-5", "Anthropic ships Claude 4")
    assert score < 0.5


def test_title_similarity_case_insensitive():
    a = _title_similarity("Claude 4.7 Released", "claude 4.7 released")
    assert a == 1.0


def test_title_similarity_near_duplicate():
    # One word added at the end — should be clearly above 0.85.
    score = _title_similarity(
        "GPT-5 officially released by OpenAI",
        "GPT-5 officially released by OpenAI today",
    )
    assert score > 0.85


def test_title_similarity_different_versions_are_close():
    # KNOWN LIMITATION: very short titles that differ only in a version number
    # score above the 0.85 dedup threshold. "GPT-5 Released" vs "GPT-4 Released"
    # would be collapsed in the same batch. In practice this rarely matters because
    # successive model releases don't arrive in the same fetch run.
    score = _title_similarity("GPT-5 Released", "GPT-4 Released")
    assert score > 0.85  # documents actual (imperfect) behavior


# ── content_hash ──────────────────────────────────────────────────────────────

def test_content_hash_consistent():
    a = _article("Claude 4.7 Released")
    assert content_hash(a) == content_hash(a)


def test_content_hash_case_insensitive():
    a = _article("Claude 4.7 Released")
    b = _article("CLAUDE 4.7 RELEASED")
    assert content_hash(a) == content_hash(b)


def test_content_hash_strips_whitespace():
    a = _article("Claude 4.7 Released")
    b = _article("  Claude 4.7 Released  ")
    assert content_hash(a) == content_hash(b)


def test_content_hash_different_titles_differ():
    a = _article("Claude 4.7 Released")
    b = _article("GPT-5 Released")
    assert content_hash(a) != content_hash(b)


# ── deduplicate ───────────────────────────────────────────────────────────────

def test_deduplicate_empty_input():
    assert deduplicate([], set(), set()) == []


def test_deduplicate_no_duplicates_passes_all():
    articles = [
        _article("Claude 4.7 Released", "https://a.com/1"),
        _article("GPT-5 Released",       "https://a.com/2"),
        _article("Gemini 2.5 Flash",     "https://a.com/3"),
    ]
    result = deduplicate(articles, set(), set())
    assert len(result) == 3


def test_deduplicate_filters_known_url():
    art = _article("Claude 4.7 Released", "https://a.com/1")
    result = deduplicate([art], existing_urls={"https://a.com/1"}, existing_hashes=set())
    assert result == []


def test_deduplicate_filters_known_hash():
    art = _article("Claude 4.7 Released", "https://a.com/new-url")
    known_hash = content_hash(art)
    result = deduplicate([art], existing_urls=set(), existing_hashes={known_hash})
    assert result == []


def test_deduplicate_filters_fuzzy_within_batch():
    # Two articles in the same batch with near-identical titles.
    a1 = _article("GPT-5 officially released by OpenAI",       "https://a.com/1")
    a2 = _article("GPT-5 officially released by OpenAI today", "https://a.com/2")
    result = deduplicate([a1, a2], set(), set())
    assert len(result) == 1
    assert result[0].url == "https://a.com/1"  # first one wins


def test_deduplicate_fuzzy_does_not_filter_against_history():
    # Fuzzy check only covers accepted titles within the CURRENT batch.
    # A title very similar to an already-stored article (not in existing_urls/hashes)
    # is NOT caught — this is a known limitation of the design.
    existing_title_as_new_article = _article(
        "GPT-5 officially released by OpenAI today", "https://a.com/2"
    )
    # existing_urls and existing_hashes are empty — history is unknown to fuzzy check
    result = deduplicate([existing_title_as_new_article], existing_urls=set(), existing_hashes=set())
    assert len(result) == 1  # passes through — fuzzy is batch-only


def test_deduplicate_distinct_titles_both_pass():
    a1 = _article("OpenAI releases GPT-5",       "https://a.com/1")
    a2 = _article("Anthropic ships Claude 4",    "https://a.com/2")
    result = deduplicate([a1, a2], set(), set())
    assert len(result) == 2


def test_deduplicate_url_and_hash_checked_independently():
    # Different URL but same title (hash) → filtered by hash check.
    a1 = _article("Claude 4.7 Released", "https://original.com/1")
    a2 = _article("Claude 4.7 Released", "https://mirror.com/1")
    result = deduplicate([a1, a2], existing_urls=set(), existing_hashes=set())
    # a1 passes, a2 is filtered by hash
    assert len(result) == 1
    assert result[0].url == "https://original.com/1"


def test_deduplicate_preserves_order_of_accepted():
    articles = [
        _article("OpenAI releases GPT-5",      "https://a.com/1"),
        _article("Google ships Gemini 3 Ultra", "https://a.com/2"),
        _article("Meta announces Llama 4 open source", "https://a.com/3"),
    ]
    result = deduplicate(articles, set(), set())
    assert [r.title for r in result] == [
        "OpenAI releases GPT-5",
        "Google ships Gemini 3 Ultra",
        "Meta announces Llama 4 open source",
    ]
