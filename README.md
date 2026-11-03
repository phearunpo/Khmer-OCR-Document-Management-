# Khmer OCR Document Management

A document-management project for organizing Khmer-language files and preparing them for OCR.

## Project status

- **Frontend:** React dashboard for adding PDF and image file details, searching, and filtering. The current preview keeps entries in browser memory and does not upload files.
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

Open the local URL printed by Vite. The frontend is currently a standalone preview and is not connected to the API yet.

## Document API

Both endpoints require Laravel Sanctum authentication:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/documents` | List the authenticated user's documents, newest first |
| `POST` | `/api/documents` | Upload one document using multipart form field `file` |

Uploads accept PDF, PNG, and JPEG files up to 10 MB. Files are stored privately and are not exposed by a public URL. The API response includes document metadata, not the private storage path.

Example upload, using an available Sanctum bearer token:

```powershell
curl.exe -H "Authorization: Bearer <token>" -F "file=@document.pdf" http://127.0.0.1:8000/api/documents
```

An API token issuance or sign-in flow has not been implemented yet, so the protected endpoints cannot be used from the frontend until authentication is added.

## Tests

From `backend`:

```powershell
php artisan test
```

The PHP CLI must have the PDO SQLite extension enabled to run tests with the in-memory SQLite database.