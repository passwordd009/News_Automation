import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.models import Article, ArticleStatus, Base


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    with Session(engine, future=True) as session:
        yield session


def test_article_round_trip_with_defaults(session):
    session.add(Article(title="City opens new library", url="https://example.com/library", source="Example"))
    session.commit()

    stored = session.scalars(select(Article)).one()
    assert stored.status == ArticleStatus.CANDIDATE.value
    assert stored.approved is False
    assert stored.created_at is not None
    assert stored.discovered_at is not None
    assert stored.overall_score is None


def test_url_is_unique_so_the_same_story_is_stored_once(session):
    session.add(Article(title="A", url="https://example.com/a", source="Example"))
    session.commit()

    session.add(Article(title="A (reprint)", url="https://example.com/a", source="Other"))
    with pytest.raises(IntegrityError):
        session.commit()
