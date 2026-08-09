# TaxiLink

TaxiLink is a smart taxi demand monitoring and dispatch system. It allows passengers to check in at designated waiting spots, while drivers and dispatchers view passenger demand and manage taxi dispatch decisions.

## Current project structure

```text
TaxiLink/
├── backend/       # Django REST Framework backend
├── frontend/      # React/Vite web frontend
└── docs/          # Project documents, if added by the team
```

## Requirements

Install these on your machine:

- Python 3.11 or newer
- Node.js 20 or newer
- PostgreSQL, optional for now because local SQLite mode is enabled in the example environment file
- VS Code

## Backend setup

Open PowerShell in the project root, then run:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

The backend should run at:

```text
http://127.0.0.1:8000/
```

Django admin:

```text
http://127.0.0.1:8000/admin/
```

## Frontend setup

Open a second PowerShell terminal in the project root, then run:

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

The frontend should run at:

```text
http://localhost:5173/
```

## Important notes

Do not commit these folders or files:

- `frontend/node_modules/`
- `backend/.venv/`
- `backend/.env`
- `frontend/.env`
- `backend/db.sqlite3`

They are ignored by the root `.gitignore` file.
