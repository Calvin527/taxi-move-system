# TAXI MOVE 🚕

### Smart Taxi Dispatch & Passenger Management Platform

TAXI MOVE is a full-stack web application designed to improve public taxi transportation through passenger demand monitoring, location-based waiting spots, and coordinated taxi dispatching.

The platform connects passengers, drivers, and dispatchers through a centralized system that supports passenger check-ins, taxi assignments, boarding verification, and trip management.

Originally developed as TaxiLink, the application has been rebranded to TAXI MOVE to support future expansion across different provinces in South Africa.

---

## 1. Project Overview

Traditional taxi transportation often relies on manual communication between passengers, drivers, and dispatchers.

This can make it difficult to determine:

- How many passengers are waiting for transport.
- Where passengers are waiting.
- Which drivers are available.
- How to assign taxis efficiently.
- Whether passengers have boarded their assigned taxis.
- Whether passengers have reached their destinations safely.

TAXI MOVE aims to address these challenges through a centralized digital platform.

---

## 2. Key Features

### Passenger Features

- Passenger registration and authentication.
- View available taxi routes.
- Find designated waiting spots.
- View waiting-spot locations.
- GPS-based passenger check-in.
- Geofence validation for designated waiting spots.
- Register individual or group transport requests.
- View current waiting-request status.
- Receive taxi assignment information.
- Boarding-code verification.
- Confirm safe arrival.
- Cancel eligible waiting requests.

### Driver Features

- Secure driver authentication.
- Manage driver availability.
- View assigned dispatch requests.
- Accept or reject taxi assignments.
- Update dispatch status.
- Share GPS coordinates during active dispatches.
- Verify passenger boarding codes.
- Complete trips after boarding requirements are satisfied.

### Dispatcher Features

- Manage taxi routes.
- Create and manage designated waiting spots.
- Select waiting-spot locations on an interactive map.
- Configure waiting-spot geofence boundaries.
- Monitor passenger demand.
- View available drivers.
- Create taxi dispatch assignments.
- Monitor dispatch progress.
- View driver location updates.
- Manage taxi dispatch operations.

---

## 3. Role-Based Access Control

TAXI MOVE supports three primary user roles.

| Role       | Responsibilities                                                          |
| ---------- | ------------------------------------------------------------------------- |
| Passenger  | Check in, request transport, track request status, and confirm arrival    |
| Driver     | Manage availability, respond to dispatches, and verify passenger boarding |
| Dispatcher | Manage routes, waiting spots, drivers, and taxi assignments               |

Role-based permissions are implemented using Django REST Framework.

Authentication uses JSON Web Tokens (JWT).

---

## 4. Technology Stack

### Backend

- Python
- Django 5.2
- Django REST Framework
- Simple JWT
- PostgreSQL
- SQLite for local development
- Gunicorn
- WhiteNoise

### Frontend

- React 19
- Vite 8
- JavaScript
- React Router
- Axios
- Leaflet
- HTML5
- CSS3

### Deployment

The planned deployment architecture uses:

- GitHub for source-code management.
- Render for the Django REST API.
- Render Static Sites for the React frontend.
- Neon PostgreSQL for the production database.

---

## 5. System Architecture

TAXI MOVE follows a client-server architecture.

```text
                 TAXI MOVE
                     |
             React Frontend
                     |
                  Axios
                     |
              REST API (HTTPS)
                     |
          Django REST Framework
                     |
           Authentication (JWT)
                     |
             Business Logic
                     |
              PostgreSQL
```

The frontend communicates with the Django backend through REST API endpoints.

The backend handles authentication, permissions, passenger requests, route management, dispatch assignments, and database operations.

---

## 6. Project Structure

```text
TAXI-MOVE/
│
├── backend/
│   ├── accounts/
│   │
│   ├── transport/
│   │
│   ├── config/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   │
│   ├── build.sh
│   ├── manage.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── context/
│   │   └── pages/
│   │
│   ├── index.html
│   ├── package.json
│   └── package-lock.json
│
├── .gitignore
└── README.md
```

---

## 7. System Requirements

Install the following tools:

- Python 3.11 or newer.
- Node.js 22.12 or newer.
- npm.
- Git.
- A code editor such as Visual Studio Code.

PostgreSQL is optional for local development because the project supports SQLite.

---

## 8. Backend Installation

### Step 1: Open the backend directory

```powershell
cd backend
```

### Step 2: Create a virtual environment

```powershell
python -m venv .venv
```

### Step 3: Activate the virtual environment

On Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

### Step 4: Install dependencies

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### Step 5: Configure environment variables

Create a `.env` file inside the `backend` directory.

Example local development configuration:

```env
DJANGO_SECRET_KEY=django-insecure-local-development-only

DEBUG=True

ALLOWED_HOSTS=localhost,127.0.0.1

CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

USE_SQLITE=True
```

Generate a secure secret key when deploying the application to production.

### Step 6: Apply migrations

```powershell
python manage.py migrate
```

### Step 7: Create an administrator account

```powershell
python manage.py createsuperuser
```

### Step 8: Start Django

```powershell
python manage.py runserver
```

Backend:

http://127.0.0.1:8000/

Django administration:

http://127.0.0.1:8000/admin/

---

## 9. Frontend Installation

Open another terminal in the project root.

### Step 1: Navigate to the frontend

```powershell
cd frontend
```

### Step 2: Install dependencies

```powershell
npm install
```

### Step 3: Configure the API URL

Create a `.env` file inside the `frontend` directory.

Add:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
```

### Step 4: Start the development server

```powershell
npm run dev
```

Open:

http://localhost:5173/

---

## 10. API Endpoints

The Django backend exposes REST API endpoints under the following prefixes:

| Endpoint Prefix                    | Description                                |
| ---------------------------------- | ------------------------------------------ |
| `/api/accounts/`                   | Authentication and account management      |
| `/api/transport/routes/`           | Taxi route management                      |
| `/api/transport/waiting-spots/`    | Waiting-spot management                    |
| `/api/transport/waiting-requests/` | Passenger waiting requests                 |
| `/api/transport/dispatches/`       | Taxi dispatch assignments                  |
| `/api/transport/drivers/`          | Driver availability and related operations |

Protected endpoints require authentication.

Some operations are restricted to specific user roles.

---

## 11. GPS and Geofencing

TAXI MOVE uses geolocation to support location-based passenger and driver operations.

### Waiting-Spot Geofencing

Dispatchers can define waiting spots using:

- Latitude.
- Longitude.
- Geofence radius.
- Assigned taxi route.

Passengers must be within the permitted waiting-spot area to perform location-validated check-ins.

### Distance Calculation

The backend uses the Haversine formula to calculate the approximate geographical distance between GPS coordinates.

### Driver Location Monitoring

During supported active dispatch states, drivers can submit GPS updates.

Dispatchers can use these updates to monitor the location of assigned taxis.

Location tracking is subject to authentication and dispatch permissions.

---

## 12. Passenger and Dispatch Workflow

### Step 1: Route Creation

A dispatcher creates a taxi route.

### Step 2: Waiting-Spot Registration

The dispatcher adds designated waiting spots to the route using the map-based interface.

### Step 3: Passenger Check-In

A passenger selects a waiting spot and submits a location-validated waiting request.

### Step 4: Demand Monitoring

The dispatcher views waiting passenger demand.

### Step 5: Taxi Assignment

The dispatcher assigns an available driver to collect passengers.

### Step 6: Driver Response

The assigned driver accepts or rejects the dispatch request.

### Step 7: Boarding Verification

Passenger boarding codes are verified during the boarding process.

### Step 8: Trip Completion

The driver completes the dispatch after the required boarding checks.

### Step 9: Safe Arrival

The passenger confirms arrival through the application.

---

## 13. Operating Hours

The configured service hours for new passenger check-ins are:

**04:00 – 17:00 (South African Standard Time)**

Existing trips may continue beyond the closing time.

---

## 14. Security

The application includes:

- JWT-based authentication.
- Role-based access control.
- Django password validation.
- Protected API endpoints.
- Server-side business-rule validation.
- Environment-based configuration.
- Restricted cross-origin access.

Production deployment requires HTTPS, secure environment variables, and appropriate database access controls.

---

## 15. Testing and Validation

Useful development checks include:

### Django System Check

```powershell
python manage.py check
```

### Database Migration Check

```powershell
python manage.py showmigrations
```

### Frontend Production Build

```powershell
npm run build
```

Important workflows should be tested using passenger, driver, and dispatcher accounts before production use.

---

## 16. Deployment

TAXI MOVE is being prepared for deployment using Render and Neon PostgreSQL.

### Backend Deployment

Platform: Render Web Service

Build command:

```bash
bash build.sh
```

Start command:

```bash
gunicorn config.wsgi:application --bind 0.0.0.0:$PORT
```

### Frontend Deployment

Platform: Render Static Site

Build command:

```bash
npm ci && npm run build
```

Publish directory:

```text
dist
```

### Database

Platform: Neon PostgreSQL

The backend reads its production connection string through the `DATABASE_URL` environment variable.

Production credentials must be configured privately through the hosting platform.

---

## 17. Future Improvements

Potential future enhancements include:

- Expansion to additional South African provinces.
- Advanced route planning.
- Taxi arrival-time estimation.
- Push notifications.
- Additional passenger safety features.
- Historical demand analytics.
- Improved dispatcher reporting.
- Advanced driver and fleet management.
- Mobile application support.

---

## 18. Project Status

**Status: Active Development**

The application is under active development, testing, and deployment preparation.

Additional improvements will be introduced incrementally.

---

## 19. Author

**Maroka Musa Calvin**

Computer Science Honours Student

Software Engineering | Backend Development | Full-Stack Development

---

## 20. Important Notes

Do not commit the following files or directories:

```text
backend/.env
frontend/.env
backend/.venv/
backend/db.sqlite3
frontend/node_modules/
frontend/dist/
backend/staticfiles/
```

These should be excluded through the root `.gitignore` file.

Never commit database credentials, JWT signing secrets, or other production credentials.

---

## 21. License

No open-source license has been selected yet.

All rights are reserved unless a license is added to this repository.
