# Khmer OCR Document Management

A document-management project for organizing Khmer-language files and preparing them for OCR.

## Project status

- **Frontend:** React dashboard for signing in, listing documents, and uploading PDF/image files through the API.
- **Backend:** Laravel API for authenticated document uploads and listing. Files are stored on Laravel's private local disk.
- **OCR:** Processing is not connected yet.

## Requirements

- PHP 8.3 or later and Composer
- Node.js and npm

## Run locally

### Backend API

In PowerShell:

```powershell
cd backend
composer install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if (-not (Test-Path database\database.sqlite)) { New-Item -ItemType File database\database.sqlite }
php artisan key:generate
php artisan migrate
php artisan serve
```

The API is available at `http://127.0.0.1:8000`. Configure a database in `backend/.env` if you do not want to use SQLite.

### Frontend

In a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite. The frontend connects to the API at `http://127.0.0.1:8000/api` by default. Set `VITE_API_BASE_URL` in `frontend/.env.local` to override it. The backend's `FRONTEND_URL` must match the browser origin (default `http://localhost:5173`) for CORS.

## Authentication and document API

Create an account to receive a Laravel Sanctum bearer token:

```powershell
curl.exe -H "Content-Type: application/json" -d '{"name":"Your Name","email":"you@example.com","password":"your-password","password_confirmation":"your-password"}' http://127.0.0.1:8000/api/register
```

Register in the frontend or sign in with an existing user account. For direct API requests, use the returned `token` as `Authorization: Bearer YOUR_TOKEN`. Registration and login are rate limited.

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/register` | Create an account and receive a bearer token |
| `POST` | `/api/login` | Exchange email and password for a bearer token |
| `POST` | `/api/logout` | Revoke the current bearer token (authentication required) |
| `POST` | `/api/logout/others` | Revoke the authenticated user's other bearer tokens |
| `GET` | `/api/documents/summary` | Return the authenticated user's document totals by type |
| `GET` | `/api/documents` | List 10 documents per page by default; accepts `page`, `per_page` (1-100), `search`, `type=PDF\|Image`, `sort=name\|date`, and `direction=asc\|desc` (authentication required) |
| `POST` | `/api/documents` | Upload one document using multipart form field `file` (authentication required) |
| `PATCH` | `/api/documents/{id}` | Rename one of the authenticated user's documents |
| `GET` | `/api/documents/{id}/preview` | Preview a private document owned by the authenticated user |
| `GET` | `/api/documents/{id}/download` | Download a private document owned by the authenticated user |
| `DELETE` | `/api/documents/{id}` | Delete one of the authenticated user's documents and its stored file (authentication required) |

Uploads accept PDF, PNG, and JPEG files up to 10 MB. Files are stored privately and are not exposed by a public URL. The API response includes document metadata, not the private storage path.

Example upload, using the bearer token returned by login:

```powershell
curl.exe -H "Authorization: Bearer YOUR_TOKEN" -F "file=@document.pdf" http://127.0.0.1:8000/api/documents
```

## Tests

From `backend`:

```powershell
php artisan test
```

The PHP CLI must have the PDO SQLite extension enabled to run tests with the in-memory SQLite database.