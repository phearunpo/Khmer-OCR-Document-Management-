# KhmerDocs frontend

React and Vite dashboard for the Khmer OCR document management API. Users can edit their profile and change their password, while the document library supports favorites, archiving, document notes, bulk deletion, filtered CSV export, server-side pagination with selectable page sizes, whole-library totals, search, type filters, sorting by name or date, document details, previews, extension-validated renaming, downloads, deletion, and upload progress. The OCR dialog offers Khmer/English recognition, live page progress, retries, copy, and private text downloads. Recognition continues in the background when the dialog closes; see the root README for worker setup.

## Run locally

```powershell
npm ci
npm run dev
```

By default, the frontend calls `http://127.0.0.1:8000/api`. To change the API URL, set `VITE_API_BASE_URL` in `.env.local`, for example:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Configure the backend `FRONTEND_URL` to match the origin shown by Vite. Users can register a new account or sign in with an existing backend account. The frontend keeps the bearer token in session storage and removes it when signing out.

Choose **Analyze / read → Tables & schedules** for document analysis. Results include original table structure, merged and empty cells, a schedule reader, review indicators, spreadsheet copy/CSV download, and labeled reading text. Read aloud uses an installed local Khmer/English voice when available. Existing plain-text results require a new structured analysis.

## Checks

```powershell
npm run lint
npm test
npm run build
```
