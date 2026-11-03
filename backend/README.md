# Backend API

This directory contains the Laravel API for Khmer OCR Document Management. For project-wide setup, see the [root README](../README.md).

## Document endpoints

Both endpoints require Sanctum authentication:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/documents` | List the signed-in user's documents, newest first |
| `POST` | `/api/documents` | Upload a document as multipart form field `file` |

PDF, PNG, and JPEG files up to 10 MB are accepted. Uploads are stored on Laravel's private `local` disk. Responses contain document metadata and do not expose storage paths.

Example:

```powershell
curl.exe -H "Authorization: Bearer <token>" -F "file=@document.pdf" http://127.0.0.1:8000/api/documents
```

An authentication or token issuance flow is not implemented yet. The endpoints require a Sanctum token supplied by an existing authentication flow.

## Tests

Run the test suite with `php artisan test`. The PHP CLI needs PDO SQLite enabled for the in-memory test database.
