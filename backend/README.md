# Backend API

This directory contains the Laravel API for Khmer OCR Document Management. For project-wide setup, see the [root README](../README.md).

The API allows requests from the frontend origin configured by `FRONTEND_URL` (default `http://localhost:5173`). Set this value to the origin serving the frontend when it differs.

## Authentication and document endpoints

Sign in with an existing user account to receive a Laravel Sanctum bearer token:

```powershell
curl.exe -H "Content-Type: application/json" -d '{"email":"you@example.com","password":"your-password"}' http://127.0.0.1:8000/api/login
```

Send the returned token as `Authorization: Bearer YOUR_TOKEN` on authenticated requests. Login is rate limited. Registration is not implemented; provision user accounts separately.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/login` | Exchange email and password for a bearer token |
| `POST` | `/api/logout` | Revoke the current bearer token (authentication required) |
| `GET` | `/api/documents` | List 10 documents per page; accepts `page`, `search`, and `type=PDF\|Image` (authentication required) |
| `POST` | `/api/documents` | Upload a document as multipart form field `file` (authentication required) |
| `GET` | `/api/documents/{id}/download` | Download a private document owned by the signed-in user |
| `DELETE` | `/api/documents/{id}` | Delete one of the signed-in user's documents and its stored file (authentication required) |

PDF, PNG, and JPEG files up to 10 MB are accepted. Uploads are stored on Laravel's private `local` disk. Responses contain document metadata and do not expose storage paths.

Example upload:

```powershell
curl.exe -H "Authorization: Bearer YOUR_TOKEN" -F "file=@document.pdf" http://127.0.0.1:8000/api/documents
```

## Tests

Run the test suite with `php artisan test`. The PHP CLI needs PDO SQLite enabled for the in-memory test database.
