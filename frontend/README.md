# KhmerDocs frontend

React and Vite dashboard for the Khmer OCR document management API. The document library supports server-side pagination with selectable page sizes, whole-library totals, search, type filters, sorting by name or date, previews, renaming, downloads, deletion, and upload progress.

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

## Checks

```powershell
npm run lint
npm test
npm run build
```
