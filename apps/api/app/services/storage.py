"""Secure file storage.

* Uploads are treated as hostile: extension allow-list + magic-byte check + size cap.
* Files are stored encrypted (Fernet) under a random server-side name, outside any web root.
* The original filename is kept only as display metadata, sanitised, never used as a path.
"""
from __future__ import annotations

import hashlib
import io
import re
import secrets
import zipfile
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import StoredFile
from app.security.crypto import decrypt_bytes, encrypt_bytes

ALLOWED = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
}
# Macro-enabled and legacy formats are refused outright.
REFUSED = {".xlsm", ".xls", ".xlsb", ".docm", ".exe", ".js", ".html", ".svg", ".zip"}


@dataclass
class ValidatedUpload:
    data: bytes
    mime: str
    ext: str
    safe_name: str


def _sniff(data: bytes, ext: str) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"PK\x03\x04") and ext == ".xlsx":
        return ALLOWED[".xlsx"] if _is_safe_xlsx(data) else None
    if ext == ".csv":
        try:
            data[:4096].decode("utf-8")
        except UnicodeDecodeError:
            return None
        return "text/csv"
    return None


def _is_safe_xlsx(data: bytes) -> bool:
    """Reject zip bombs, macro projects and anything that is not a plain workbook."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = z.namelist()
            if "[Content_Types].xml" not in names or not any(n.startswith("xl/") for n in names):
                return False
            if any("vbaProject" in n or n.endswith(".bin") for n in names):
                return False
            total = sum(i.file_size for i in z.infolist())
            if total > 100 * 1024 * 1024 or len(names) > 2000:
                return False
            for i in z.infolist():
                if i.compress_size and i.file_size / max(i.compress_size, 1) > 200:
                    return False
    except zipfile.BadZipFile:
        return False
    return True


def safe_display_name(name: str) -> str:
    name = Path(name or "file").name  # drop any directory components (path traversal)
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:120].strip(" .")
    return name or "file"


async def read_and_validate(upload: UploadFile) -> ValidatedUpload:
    s = get_settings()
    max_bytes = s.max_upload_mb * 1024 * 1024
    name = safe_display_name(upload.filename or "")
    ext = Path(name).suffix.lower()
    if ext in REFUSED or ext not in ALLOWED:
        raise HTTPException(415, "File type not allowed. Upload PDF, JPG, PNG, WEBP, XLSX or CSV.")
    buf = bytearray()
    while chunk := await upload.read(1024 * 1024):
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(413, f"File is larger than {s.max_upload_mb} MB")
    data = bytes(buf)
    if not data:
        raise HTTPException(400, "Empty file")
    mime = _sniff(data, ext)
    expected = ALLOWED[ext]
    if mime is None or (mime != expected and not (ext in (".jpg", ".jpeg") and mime == "image/jpeg")):
        raise HTTPException(415, "File content does not match its type.")
    return ValidatedUpload(data=data, mime=mime, ext=ext, safe_name=name)


def _check_name(stored_name: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{48}", stored_name):
        raise ValueError("invalid stored name")
    return stored_name


def _path_for(stored_name: str) -> Path:
    _check_name(stored_name)
    root = get_settings().storage_dir.resolve() / "files"
    p = (root / stored_name[:2] / stored_name).resolve()
    if root not in p.parents:
        raise ValueError("path escape")
    return p


class _Local:
    def put(self, name: str, blob: bytes) -> None:
        path = _path_for(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)

    def get(self, name: str) -> bytes:
        return _path_for(name).read_bytes()

    def remove(self, name: str) -> None:
        _path_for(name).unlink(missing_ok=True)

    def ready(self) -> bool:
        root = get_settings().storage_dir.resolve() / "files"
        root.mkdir(parents=True, exist_ok=True)
        return root.is_dir()


class _S3:
    """Any S3-compatible object store. Blobs are already Fernet-encrypted; SSE is requested as well."""

    def __init__(self) -> None:
        import boto3  # imported only when S3 is configured
        from botocore.config import Config

        s = get_settings()
        self.bucket = s.s3_bucket
        self.prefix = s.s3_prefix
        self.client = boto3.client(
            "s3", endpoint_url=s.s3_endpoint_url or None, region_name=s.s3_region or None,
            aws_access_key_id=s.s3_access_key_id or None, aws_secret_access_key=s.s3_secret_access_key or None,
            config=Config(retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=5, read_timeout=30))

    def _key(self, name: str) -> str:
        return f"{self.prefix}{_check_name(name)[:2]}/{name}"

    def put(self, name: str, blob: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self._key(name), Body=blob,
                               ContentType="application/octet-stream", ServerSideEncryption="AES256")

    def get(self, name: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=self._key(name))["Body"].read()

    def remove(self, name: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(name))

    def ready(self) -> bool:
        self.client.head_bucket(Bucket=self.bucket)
        return True


_backend = None


def backend():
    global _backend
    if _backend is None:
        _backend = _S3() if get_settings().storage_backend == "s3" else _Local()
    return _backend


def save(db: Session, data: bytes, original_name: str, mime: str, uploaded_by: str | None,
         scan_status: str = "pending") -> StoredFile:
    stored_name = secrets.token_hex(24)
    backend().put(stored_name, encrypt_bytes(data))
    f = StoredFile(stored_name=stored_name, original_name=safe_display_name(original_name), mime=mime,
                   size=len(data), sha256=hashlib.sha256(data).hexdigest(), uploaded_by_id=uploaded_by,
                   scan_status=scan_status)
    db.add(f)
    db.flush()
    return f


def load(f: StoredFile) -> bytes:
    data = decrypt_bytes(backend().get(f.stored_name))
    if hashlib.sha256(data).hexdigest() != f.sha256:
        raise ValueError("integrity check failed")
    return data


def delete(f: StoredFile) -> None:
    try:
        backend().remove(f.stored_name)
    except ValueError:
        pass


def temp_dir() -> Path:
    d = get_settings().storage_dir.resolve() / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    return d
