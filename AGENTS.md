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
- `server.js`: Express server, routes, CORS (`origin: '*'`), static serving
- `src/database.js`: sql.js wrapper, schema, auto-save every 10s
- `src/auth.js`: JWT sign/verify, bcrypt hash, AES-256-GCM encrypt/decrypt
- `src/routes/auth.js`: Login/signup routes (admin, customer, provider)
- `src/routes/admin.js`: Admin CRUD for users, providers, tasks, revenue, settings
- `src/routes/provider.js`: Provider task management
- `src/routes/customer.js`: Customer ordering, payments, ratings
- `src/routes/chat.js`: Chat between customer/provider/admin
- `render.yaml`: Render deployment config
- `public/index.html`: Frontend (3562 lines, Tailwind CSS, all portals)

## Frontend Portals
- **Public**: Home, Services, Reviews, Bookings
- **Customer**: Sign up, sign in, place orders, tracking, payments, ratings
- **Provider**: Login, active/completed tasks, earnings, price management
- **Admin**: Login, dashboard (users, providers, tasks, revenue, charts, settings, chat)
- **Admin features**: CRUD on users/providers, approve providers, assign tasks, manage prices, chat with all, system settings, account deletion requests

## Known Limitations
- Free tier SQLite data lost on redeploy (no persistent disk)
- All frontend JS in single HTML file (no framework, vanilla JS)
- CORS allows all origins (permissive for demo)
- No email/SMS notifications (placeholder system)
