# HavenGo Uganda — Project Summary

## Architecture
- **Frontend**: Single-page HTML (`public/index.html`), Tailwind CSS, serves at `/` from Express
- **Backend**: Node.js/Express, SQLite (sql.js), JWT auth, bcrypt, AES-256-GCM encryption, helmet, rate limiting
- **Deployment**: Render (backend web service, free tier) + Netlify (frontend static site)

## URLs
- **Backend (Render)**: https://havengo-backend.onrender.com
- **Frontend (Netlify)**: https://havengo.netlify.app
- **GitHub Backend**: https://github.com/tituspeterson23-cmyk/havengo-backend
- **GitHub Frontend**: https://github.com/tituspeterson23-cmyk/havengo-frontend

## Credentials
- **Admin**: `thermypetson@gmail.com` / `23.Forlife`
- **Demo Provider**: `aisha@havengo.ug` / `password`

## GitHub
- Username: `tituspeterson23-cmyk`

## Deploy Notes
- Backend deployed via Render Blueprint (`render.yaml` — free plan, no disk mount)
- Frontend auto-deploys from GitHub via Netlify import
- Render free tier sleeps after 15 min idle, wakes on first request (~15s delay)
- **SQLite database stored in `./data/havengo.db`** — persists across sleep/wake, lost on redeploy
- Frontend env var `HAVENGO_BACKEND_URL = https://havengo-backend.onrender.com` hardcoded in `index.html`

## Key Backend Files
- `server.js`: Express server, routes, CORS (`origin: '*'`), static serving, `GET /api/providers/verified` (public)
- `src/database.js`: sql.js wrapper, schema (users, providers, tasks, completed_tasks, chat_messages, notifications, price_requests, reviews, etc.), auto-save every 10s
- `src/auth.js`: JWT sign/verify, bcrypt hash, AES-256-GCM encrypt/decrypt
- `src/routes/auth.js`: Login/signup routes (admin, customer, provider)
- `src/routes/admin.js`: Admin CRUD for users, providers, tasks, revenue, settings, chat conversations
- `src/routes/provider.js`: Provider task management, registration (with admin notification)
- `src/routes/customer.js`: Customer ordering, payments, ratings, notifications
- `src/routes/chat.js`: Chat between customer/provider/admin (AES encrypted)
- `render.yaml`: Render deployment config
- `public/index.html`: Frontend (~4200 lines, Tailwind CSS, all portals)

## Frontend Portals
- **Public**: Home, Services, Reviews, Bookings
- **Customer**: Sign up, sign in, place orders, tracking, payments, ratings
- **Provider**: Login, active/completed tasks, earnings, price management
- **Admin**: Login, dashboard (users, providers, tasks, revenue, charts, settings, chat)
- **Admin features**: CRUD on users/providers, approve providers, assign tasks, manage prices, chat with all, system settings, account deletion requests

## Cross-Session Features (May 23, 2026)
These changes enable the app to work across different browsers/sessions:
- **Verified providers endpoint** (`GET /api/providers/verified`): Public, returns all verified providers for service listing
- **Chat IDs use email format**: `customer-admin-{email}` and `provider-admin-{email}` for consistent cross-browser chat
- **Provider polling**: 30s interval in `enterProviderDashboard()` to fetch new tasks/completed tasks from backend
- **Admin polling**: 30s interval in `adminLoginSuccess()` to call `_syncAdminData()`
- **`loadChatFromStorage()`**: Always fetches from backend first, falls back to localStorage, merges deduplicated messages
- **`sendChatMessage()` + `sendCustomerAdminMessage()`**: POST to backend in addition to localStorage
- **Provider registration notifies admin**: Inserts notification into `notifications` table with `user_email = admin_email`
- **Conversation patterns**: `customer-admin-{email}` (customer↔admin), `provider-admin-{email}` (provider↔admin), `{taskId}` (task-specific)

## Data Isolation
- Backend JWT auth ensures customers/providers/admins only access their own data
- Tasks scoped by provider email, conversations by participant email
- Frontend localStorage is per-browser; backend persistence enables cross-browser data access

## Known Limitations
- Free tier SQLite data lost on redeploy (no persistent disk)
- All frontend JS in single HTML file (no framework, vanilla JS)
- CORS allows all origins (permissive for demo)
- No email/SMS notifications (placeholder system)
- Provider-admin chat ID changed from `admin-{id}` to `provider-admin-{email}` — existing `admin-*` chats still shown for backward compat
