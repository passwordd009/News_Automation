from pathlib import Path

from app.config import PROJECT_ROOT, _absolute_sqlite_url


def test_relative_sqlite_path_is_anchored_to_the_project_root():
    """Otherwise the database depends on where you happened to run the command.

    Collecting from one directory and generating the document from another
    would silently use two different database files.
    """
    url = _absolute_sqlite_url("sqlite:///hestia_news.db")

    assert url == f"sqlite:///{PROJECT_ROOT / 'hestia_news.db'}"
    assert Path(url.replace("sqlite:///", "")).is_absolute()


def test_absolute_and_memory_urls_are_left_alone():
    assert _absolute_sqlite_url("sqlite:////var/data/hestia.db") == "sqlite:////var/data/hestia.db"
    assert _absolute_sqlite_url("sqlite:///:memory:") == "sqlite:///:memory:"
    assert _absolute_sqlite_url("sqlite://") == "sqlite://"


def test_non_sqlite_urls_are_untouched():
    url = "postgresql+psycopg://user:pw@localhost/hestia"
    assert _absolute_sqlite_url(url) == url
