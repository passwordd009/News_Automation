from app.processing.url_normalizer import domain_of, normalize_url


def test_strips_utm_parameters():
    url = "https://gothamist.com/news/story?utm_source=newsletter&utm_medium=email&id=42"
    assert normalize_url(url) == "https://gothamist.com/news/story?id=42"


def test_drops_www_fragment_and_trailing_slash():
    assert normalize_url("https://www.amny.com/news/story/#top") == "https://amny.com/news/story"


def test_query_order_does_not_matter():
    first = normalize_url("https://example.com/a?b=2&a=1")
    second = normalize_url("https://example.com/a?a=1&b=2")
    assert first == second


def test_default_ports_removed_but_others_kept():
    assert normalize_url("https://example.com:443/a") == "https://example.com/a"
    assert normalize_url("http://example.com:8080/a") == "http://example.com:8080/a"


def test_uppercase_host_and_scheme_normalized():
    assert normalize_url("HTTPS://WWW.Example.COM/Path") == "https://example.com/Path"


def test_protocol_relative_and_bare_urls():
    assert normalize_url("//example.com/a") == "https://example.com/a"
    assert normalize_url("example.com/a") == "https://example.com/a"


def test_rejects_unusable_urls():
    assert normalize_url(None) is None
    assert normalize_url("") is None
    assert normalize_url("mailto:someone@example.com") is None
    assert normalize_url("javascript:alert(1)") is None
    assert normalize_url("https://localhost/a") is None


def test_domain_of():
    assert domain_of("https://www.thecity.nyc/2026/09/01/story") == "thecity.nyc"
    assert domain_of("not a url") is None
