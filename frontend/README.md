# KhmerDocs frontend

React and Vite dashboard for the Khmer OCR document management API.

## Run locally

```powershell
npm ci
npm run dev
```

By default, the frontend calls `http://127.0.0.1:8000/api`. To change the API URL, set `VITE_API_BASE_URL` in `.env.local`, for example:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

Configure the backend `FRONTEND_URL` to match the origin shown by Vite. Users must sign in with an existing backend account. The frontend keeps the bearer token in session storage and removes it when signing out.

## Checks

```powershell
npm run lint
npm run build
```
