# Six Beans Coffee Co. — Workforce Management Platform

Full-stack workforce management application for Six Beans Coffee Co., a 6-location coffee company in San Diego, CA.

## Stack

- **Backend:** Python FastAPI + SQLAlchemy (async) + PostgreSQL
- **Frontend:** React 18 + TypeScript + Tailwind CSS + Vite
- **Hosting:** Render (render.yaml included)
- **Integrations:** Square API, Twilio SMS, Claude AI, GoDaddy, ADP

## Features

- **Three access levels:** Owner, Store Manager, Employee
- **Scheduling:** Template-based shifts, copy previous week, availability blocking
- **Time Clock & Kiosk:** PIN-based clock in/out, California break compliance
- **Shift Management:** Swap requests, coverage posting, manager approvals
- **Cash Drawer:** Opening/closing reconciliation, unexpected expenses, variance reports
- **Payroll:** ADP CSV export, Claude AI validation, owner approval workflow
- **Messaging:** Location-based team chat, company-wide announcements
- **Notifications:** Twilio SMS for shift reminders and approvals
- **Audit Logging:** Complete trail of all system changes
- **Owner Dashboard:** Multi-location overview, Square sales, labor analytics

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 16+

### Backend Setup

```bash
cd sixbeans/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy env file and configure
cp .env.example .env
# Edit .env with your database URL and API keys

# Create database tables and seed initial data
python -m app.seed

# Start the server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
cd sixbeans/frontend

# Install dependencies
npm install

# Start dev server (proxies to backend at localhost:8000)
npm run dev
```

Visit http://localhost:5173 for the app.

### Default Login

After seeding:
- **Owner 1:** logcastles@gmail.com / changeme123
- **Owner 2:** jessica@sixbeanscoffee.com / changeme123

Change passwords after first login.

## Deploy to Render

1. Push this repo to GitHub
2. In Render dashboard, click **New > Blueprint**
3. Connect your repo and select `sixbeans/render.yaml`
4. Render will create the API, frontend, and PostgreSQL database
5. Set your API keys in the Render environment variables

## Project Structure

```
sixbeans/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI application
│   │   ├── config.py         # Environment settings
│   │   ├── database.py       # Async SQLAlchemy
│   │   ├── dependencies.py   # Auth & role guards
│   │   ├── models/           # SQLAlchemy models (10 modules)
│   │   ├── schemas/          # Pydantic schemas (10 modules)
│   │   ├── routers/          # API endpoints (13 routers)
│   │   ├── services/         # Business logic (9 services)
│   │   └── utils/            # CA labor law, permissions
│   ├── alembic/              # Database migrations
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Routing (14 portal routes)
│   │   ├── lib/api.ts        # API client with all endpoints
│   │   ├── stores/           # Zustand auth store
│   │   ├── types/            # TypeScript interfaces
│   │   ├── components/
│   │   │   ├── ui/           # Reusable components (9)
│   │   │   └── layouts/      # Public, Portal, Kiosk layouts
│   │   └── pages/
│   │       ├── public/       # Landing, Login
│   │       ├── kiosk/        # Kiosk PIN interface
│   │       └── portal/       # All portal pages (13)
│   ├── package.json
│   └── Dockerfile
├── render.yaml               # Render deployment blueprint
└── .env.example
```

## Locations

1. Six Beans - Downtown (San Diego)
2. Six Beans - Hillcrest
3. Six Beans - North Park
4. Six Beans - Pacific Beach
5. Six Beans - La Jolla
6. Six Beans - Encinitas

## California Labor Law Compliance

- 10-minute paid breaks
- 30-minute unpaid meal breaks
- Daily overtime after 8 hours
- Double time after 12 hours
- Weekly overtime after 40 hours
- Cannot clock in more than 5 minutes before shift
- Auto clock-out at shift end time
