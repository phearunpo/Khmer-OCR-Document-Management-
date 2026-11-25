# Khmer OCR Document Management

A document-management project for organizing Khmer-language files and extracting text from PDF and image scans.

## Project status

- **Frontend:** React dashboard for signing in, listing documents, and uploading PDF/image files through the API.
- **Backend:** Laravel API for authenticated document uploads and listing. Files are stored on Laravel's private local disk.
- **OCR:** Background Khmer/English recognition, document analysis, table and schedule reading, page progress, retries, and UTF-8 text/CSV downloads. Processing runs locally with Tesseract and PyMuPDF.

## Requirements

- PHP 8.3 or later and Composer
- Node.js and npm
- Python 3.10 or later and Tesseract 5 with Khmer (`khm`) and English (`eng`) language data for OCR

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

### OCR runtime and worker

From the repository root, create the Python environment and install the OCR dependencies:

```powershell
python -m venv ocr-service/venv
./ocr-service/venv/Scripts/python.exe -m pip install -r ocr-service/requirements-ocr.txt
winget install --id UB-Mannheim.TesseractOCR --exact
```

Install both `khm.traineddata` and `eng.traineddata` from the [official Tesseract language models](https://github.com/tesseract-ocr/tessdata_fast) into the engine's `tessdata` directory, or place them in `ocr-service/.runtime/tessdata`. Run `tesseract --list-langs` (with `--tessdata-dir` when using a separate directory) to verify them. On Linux, install `tesseract-ocr`, `tesseract-ocr-khm`, and `tesseract-ocr-eng` with your package manager and use `ocr-service/venv/bin/python` for Python commands.

The backend detects the project's Python environment and the default Windows Tesseract installation. Set `OCR_PYTHON_BINARY`, `OCR_TESSERACT_BINARY`, or `OCR_TESSDATA_PATH` in `backend/.env` to override those paths.

In a third terminal:

```powershell
cd backend
php artisan queue:work ocr --queue=ocr --tries=1 --timeout=330
```

Enable PHP's `pdo_sqlite` extension in `php.ini` when using SQLite. If it is installed but disabled, the worker and migration commands can also use `php -d extension=pdo_sqlite`. Run PHPUnit directly with this flag when needed because `artisan test` and `artisan serve` start another PHP process that does not inherit it.

Upload a PDF, PNG, or JPEG, select **Analyze / read**, choose Khmer, English, or both, and start recognition. Choose **Plain text** when table structure is not needed. Progress and results remain available after closing the dialog. **Read document** opens completed results for copying or downloading. Files remain private to their owner. OCR supports up to 25 pages and 10 MB per document, with a five-minute processing limit; password-protected PDFs require an unlocked copy. Restart the worker after changing backend OCR code or configuration.

Select **Analyze / read**, choose **Tables & schedules**, and select **Analyze document** to preserve table rows and columns. The analysis view retains headers, wrapped text, merged cells, and blank cells. **Schedule reader** links each recognized time to its own row's activity, location, and other source columns, with nearby source headings retained for date context. PDF text is used directly when available; scans use positioned OCR words and grid detection. Borderless schedules are inferred conservatively and marked for review. Missing values and dates are not invented. Cells with low OCR scores, inferred boundaries, or no recognized scan text are highlighted for checking against the original.

Tables can be copied to a spreadsheet or downloaded as UTF-8 CSV. Source merged cells are repeated across their covered rows/columns in the spreadsheet export. **Reading text** and **Read aloud** follow document order and read table rows with their column headings. Read aloud requires an installed local Khmer or English browser voice. Existing plain-text results must be analyzed again in Tables & schedules mode to obtain structured tables. API requests that omit `mode` retain plain-text behavior.

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
| `PUT` | `/api/user` | Update the authenticated user's name and email |
| `PUT` | `/api/user/password` | Change the authenticated user's password |
| `GET` | `/api/documents` | List 10 documents per page by default; accepts `page`, `per_page` (1-100), `search`, `type=PDF\|Image`, `favorites=1`, `archived=1` (archived documents are excluded by default), `sort=name\|date`, and `direction=asc\|desc` (authentication required) |
| `GET` | `/api/documents/export` | Download all matching documents as CSV using the library's search, type, favorite, archive, and sort filters |
| `GET` | `/api/documents/{id}` | Return metadata for one document owned by the authenticated user |
| `POST` | `/api/documents/{id}/ocr` | Queue recognition with `language=khm+eng`, `khm`, or `eng`, and optional `mode=text` or `structured`; returns 202, or 409 when already queued/processing |
| `GET` | `/api/documents/{id}/ocr` | Read recognition status, page progress, errors, and completed text |
| `GET` | `/api/documents/{id}/ocr/download` | Download completed text as a private UTF-8 `.txt` file |
| `GET` | `/api/documents/{id}/ocr/tables/{table}/download` | Download an owned completed table, such as `p1-t1`, as UTF-8 CSV |
| `GET` | `/api/documents/{id}/notes` | Read notes for an owned document |
| `PATCH` | `/api/documents/{id}/notes` | Replace or clear notes for an owned document (up to 10,000 characters) |
| `PATCH` | `/api/documents/{id}/favorite` | Mark or unmark a document as a favorite |
| `PATCH` | `/api/documents/{id}/archive` | Archive or restore a document |
| `POST` | `/api/documents` | Upload one document using multipart form field `file` (authentication required) |
| `PATCH` | `/api/documents/{id}` | Rename an owned document while preserving its PDF, PNG, or JPEG extension |
| `GET` | `/api/documents/{id}/preview` | Preview a private document owned by the authenticated user |
| `GET` | `/api/documents/{id}/download` | Download a private document owned by the authenticated user |
| `DELETE` | `/api/documents/{id}` | Delete one of the authenticated user's documents and its stored file (authentication required) |
| `DELETE` | `/api/documents/bulk` | Delete 1-100 owned documents by sending unique document IDs in the `ids` array |

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

Run the OCR unit checks from `ocr-service` with `./venv/Scripts/python.exe -m unittest discover -s tests -v`. The backend's real-engine PDF/image integration checks are enabled by setting `$env:RUN_OCR_INTEGRATION = '1'` before running PHPUnit; these require the OCR runtime above. The remaining backend tests fake the external engine and do not require Tesseract.
