"""Creates the Weekly Wrap-Up as a real Google Doc.

The Google libraries are imported lazily so the rest of the application — and
the whole test suite — runs without them installed and without credentials.

First run opens a browser for consent and writes ``token.json`` next to your
credentials; later runs reuse it. Both files are gitignored.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import PROJECT_ROOT, get_settings
from app.google.document_builder import SEPARATOR, WeeklyDocument

logger = logging.getLogger(__name__)

# Drive scope is needed to move the doc into a folder; Docs scope to write it.
SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.file",
]


class GoogleDocsError(RuntimeError):
    """Raised when the document cannot be created."""


def _load_credentials(client_secret_file: Path, token_file: Path):
    """Run the OAuth flow, reusing a cached token when possible."""
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError as exc:  # pragma: no cover - depends on optional deps
        raise GoogleDocsError(
            "Google libraries are missing. Install them with:\n"
            "    pip install google-api-python-client google-auth google-auth-oauthlib"
        ) from exc

    credentials = None
    if token_file.exists():
        try:
            credentials = Credentials.from_authorized_user_file(str(token_file), SCOPES)
        except (ValueError, OSError) as exc:
            logger.warning("Ignoring unreadable token file %s: %s", token_file, exc)

    if credentials and credentials.valid:
        return credentials

    if credentials and credentials.expired and credentials.refresh_token:
        try:
            credentials.refresh(Request())
            token_file.write_text(credentials.to_json(), encoding="utf-8")
            return credentials
        except Exception as exc:  # noqa: BLE001 - fall through to a fresh consent
            logger.warning("Could not refresh the saved token, re-authorizing: %s", exc)

    if not client_secret_file.exists():
        raise GoogleDocsError(
            f"Google client secret file not found at {client_secret_file}.\n"
            "Create an OAuth client ID (Desktop app) in Google Cloud Console, download the\n"
            "JSON, save it as credentials.json in the project root, and enable the Google\n"
            "Docs API and Google Drive API for that project."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret_file), SCOPES)
    credentials = flow.run_local_server(port=0)
    token_file.write_text(credentials.to_json(), encoding="utf-8")
    logger.info("Saved Google credentials to %s", token_file)
    return credentials


def build_requests(document: WeeklyDocument) -> list[dict]:
    """Google Docs ``batchUpdate`` requests that lay out the document.

    Text is inserted at index 1 in reverse order, so each insert pushes the
    previously written text down and the document ends up in reading order.
    Styling is applied afterwards against the final offsets.
    """
    body = _document_body(document)

    requests: list[dict] = [{"insertText": {"location": {"index": 1}, "text": body}}]

    # Heading.
    heading_end = 1 + len(document.heading)
    requests.append(
        {
            "updateParagraphStyle": {
                "range": {"startIndex": 1, "endIndex": heading_end},
                "paragraphStyle": {"namedStyleType": "HEADING_1"},
                "fields": "namedStyleType",
            }
        }
    )

    # Bold every field label so the doc is skimmable.
    for label, start in _label_offsets(body):
        requests.append(
            {
                "updateTextStyle": {
                    "range": {"startIndex": start + 1, "endIndex": start + 1 + len(label)},
                    "textStyle": {"bold": True},
                    "fields": "bold",
                }
            }
        )

    return requests


def _document_body(document: WeeklyDocument) -> str:
    """The document as one string (the Docs API inserts plain text)."""
    parts: list[str] = [document.heading, "\n\n", f"DATE: {document.date_range}", "\n\n"]

    for entry in document.entries:
        parts.extend(
            [
                "\n",
                f"Topic: {entry.topic}",
                "\n\n",
                "URL:\n",
                entry.url,
                "\n\n",
                "Description:\n",
                entry.description,
                "\n\n",
                "Why post:\n",
                entry.why_post,
                "\n\n",
                SEPARATOR,
                "\n\n",
            ]
        )

    return "".join(parts)


def _label_offsets(body: str) -> list[tuple[str, int]]:
    """Character offsets of each field label within the body text."""
    offsets: list[tuple[str, int]] = []
    for label in ("DATE:", "Topic:", "URL:", "Description:", "Why post:"):
        start = body.find(label)
        while start != -1:
            offsets.append((label, start))
            start = body.find(label, start + 1)
    return offsets


def create_weekly_doc(document: WeeklyDocument, folder_id: str | None = None) -> str:
    """Create the doc in Google Docs and return its URL."""
    try:
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
    except ImportError as exc:  # pragma: no cover - depends on optional deps
        raise GoogleDocsError(
            "Google libraries are missing. Install them with:\n"
            "    pip install google-api-python-client google-auth google-auth-oauthlib"
        ) from exc

    settings = get_settings()
    client_secret_file = Path(settings.google_client_secret_file)
    if not client_secret_file.is_absolute():
        client_secret_file = PROJECT_ROOT / client_secret_file
    token_file = PROJECT_ROOT / "token.json"

    credentials = _load_credentials(client_secret_file, token_file)

    try:
        docs = build("docs", "v1", credentials=credentials, cache_discovery=False)
        created = docs.documents().create(body={"title": document.title}).execute()
        document_id = created["documentId"]

        docs.documents().batchUpdate(
            documentId=document_id,
            body={"requests": build_requests(document)},
        ).execute()

        if folder_id:
            _move_to_folder(credentials, document_id, folder_id)
    except HttpError as exc:
        raise GoogleDocsError(f"Google Docs API rejected the request: {exc}") from exc

    url = f"https://docs.google.com/document/d/{document_id}/edit"
    logger.info("Created Google Doc: %s", url)
    return url


def _move_to_folder(credentials, document_id: str, folder_id: str) -> None:
    """Move the new doc into a Drive folder. Failure here is not fatal."""
    from googleapiclient.discovery import build

    try:
        drive = build("drive", "v3", credentials=credentials, cache_discovery=False)
        current = drive.files().get(fileId=document_id, fields="parents").execute()
        previous = ",".join(current.get("parents", []))
        drive.files().update(
            fileId=document_id,
            addParents=folder_id,
            removeParents=previous,
            fields="id, parents",
        ).execute()
    except Exception as exc:  # noqa: BLE001 - the doc exists either way
        logger.warning("Doc created but could not be moved into folder %s: %s", folder_id, exc)
