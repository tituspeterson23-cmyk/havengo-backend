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
- `public/index.html`: Frontend (~5691 lines, Tailwind CSS, all portals)

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

## Full Feature Inventory (May 24, 2026 — All 25 items completed)

### Session 1: Bug fixes & Core Features
- **Nursing category** (`id: "nursing"`, basePrice: 80000) with care type + days options + price calculation
- **Spa & header faulty chars** — replaced UTF-8 corruption (ï¿½) with proper characters
- **Provider cancel order** — "Cancel Order" button in active tasks with reason prompt, calls `POST /api/provider/cancel-task/:taskId`, notifies customer
- **Favorite providers** — heart toggle on provider cards, `toggleFavoriteProvider()`, saved in app state, profile tab replaces saved providers
- **Delete notifications** — trash icon on each notification in modal and profile, `deleteNotification(index)`, backend `POST /api/customer/delete-notification/:id`
- **Deposit notice in profile** — blue info banner: "Money deposited can be withdrawn at any time unless there's a pending order"
- **Provider consent form** — modal with 15% fee, 50k UGX joining fee, T&C, diligent service clause; must accept before submission

### Session 2: Online-only, Balance, Auth, Alerts
- **Email/phone verification** — `performSignup()` sends code via `/api/auth/send-verification-code`, shows 6-digit input, verifies via `/api/auth/verify-code`, then registers
- **Fixed balance sync bug** — `data.user.balance || 2000000` changed to `data.user.balance !== undefined ? data.user.balance : userBalance` (preserves 0 balance)
- **In-app alerts** — `addInAppAlert(type, message)` toast at top-right (green/red/blue/amber), replaces browser `alert()` across login, signup, admin, provider, withdraw flows
- **Session restart** — `beforeunload` clears page/tab state so next visit starts from home
- **Auto-sync** — 15s polling for bookings, notifications, providers, admin data
- **Customer withdrawal restriction** — blocks withdrawal when any booking has status "Pending" or "In Progress" + pending payments check
- **Logout preserves balance** — removed `userBalance = 500000` from logout

### Session 3: Provider Payment Prompt, Dead Code, Online Cleanup
- **Payment prompt modal** — `#payment-prompt-modal` auto-shows when provider logs in with unpaid fee. Mobile Money phone input. No balance deduction.
- **Clear old notifications on signup** — `globalNotifications = []` before welcome notification
- **Fix corrupted `_doEncryptSave()`** — removed dangling `respData` references, closed properly
- **Remove dead code** — orphaned `performLogin()` copy (lines 1290-1355) with old `alert()` calls removed
- **Replace admin/provider `alert()`** — `verifyProvider()`, `rejectProvider()`, `adminDeleteProvider()`, `payRegistrationFee()` now use `addInAppAlert()`
- **Demo defaults** — `userBalance = 2000000` kept as safety net. Backend sets `balance: 2000000` on registration (signup bonus)

### Session 4: Live Maps, Tracking, 50k Fix
- **Live maps** — Leaflet.js + OpenStreetMap in `#map-modal`:
  - Address picker on checkout with Nominatim search
  - Draggable pin, GPS geolocation, ETA calc from Kampala center
  - Customer "Track" button on each booking opens map with live location
  - Provider "Share Location" button in active tasks broadcasts GPS position
- **Backend tracking** — `POST /api/tracking/update`, `GET /api/tracking/:orderId`, `tracking` table
- **50k joining fee** — provider enters Mobile Money phone, fee is simulated (no deduction, no earnings credit). Backend just marks `registration_fee_paid = 1`
- **Notification sync** — both navbar modal and profile tab use same `globalNotifications` array, both re-rendered on CRUD
- **Online-only** — no local-only data, no demo state, all data sourced from backend. localStorage used only for session cache (encrypted), dark mode, theme, chat cache

## Key Flow Diagrams

### Signup Flow
1. User fills form → `performSignup()`
2. Backend check → `POST /api/auth/send-verification-code` → 6-digit code input shown
3. User enters code → `verifySignupCode()` → `POST /api/auth/verify-code`
4. If verified → `POST /api/auth/register` (with `skipVerification: true`) → backend creates user with `balance: 2000000`
5. If send-code fails → fallback direct registration via `/api/auth/register`
6. On success: clear `globalNotifications`, set `userBalance` from backend response, `addNotification("🎉", "Account Created")`, saveAppState

### Order Placement Flow
1. Select service → `selectService(serviceId)` → `showCheckout()` → attach map picker
2. Fill date/time/address (or pick on map) → `placeOrder(event)`
3. Fetch fresh balance from `GET /api/customer/profile` (JWT)
4. Check `userBalance >= finalPrice` — if insufficient, show deposit modal with `addInAppAlert`
5. Identify provider → `POST /api/customer/place-order` (JWT)
6. On success: deduct from `userBalance`, push to `bookings` + `providerTasks`, `addNotification("📋", "New Booking Placed")`, `addInAppAlert("success", ...)`
7. Order appears in customer bookings with "Track" button, provider sees it in active tasks

### Provider Registration & Activation Flow
1. Provider fills signup form → consent modal shown (15% fee, 50k joining, T&C)
2. Accept → `submitProviderWithConsent()` → `POST /api/provider/register` → pending admin verification
3. Admin verifies → `verifyProvider(id)` → backend creates notification (type: `provider_verified`) for provider
4. Provider logs in → `loginAsProvider()` → `enterProviderDashboard()` → `fetchBackendNotifications()` retrieves verification notification
5. If `registration_fee_paid === 0` → `showProviderPaymentPrompt()` after 1s delay
6. Provider enters Mobile Money number → `payRegistrationFee()` → `POST /api/provider/pay-registration-fee` → marks `registration_fee_paid = 1`
7. Account active — provider can now receive orders

### Tracking Flow
1. Customer clicks "Track" on a booking → `startTracking(bookingId)` → opens `#map-modal` with GPS
2. "Start Live Tracking" → `navigator.geolocation.watchPosition` → `saveTrackingPosition(orderId, lat, lng, "customer")`
3. Provider clicks "Share Location" on an active task → `navigator.geolocation.watchPosition` → saves as `"provider"` role
4. Each party retrieves the other's location via `GET /api/tracking/:orderId?role=customer|provider`

## API Endpoints Summary
| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/health` | No | Health check |
| GET | `/api/providers/verified` | No | List verified providers |
| POST | `/api/auth/register` | No | Customer signup (balance: 2M) |
| POST | `/api/auth/login` | No | Customer login |
| POST | `/api/auth/admin/login` | No | Admin login |
| POST | `/api/auth/send-verification-code` | No | Send 6-digit code |
| POST | `/api/auth/verify-code` | No | Verify 6-digit code |
| POST | `/api/customer/place-order` | JWT | Place order |
| POST | `/api/customer/withdraw` | JWT | Withdraw funds (checks active orders) |
| POST | `/api/customer/delete-notification/:id` | JWT | Delete notification |
| GET | `/api/customer/notifications` | JWT | Fetch customer notifications |
| GET | `/api/customer/profile` | JWT | Get customer profile + balance |
| POST | `/api/provider/login` | No | Provider login |
| POST | `/api/provider/register` | No | Provider signup |
| POST | `/api/provider/pay-registration-fee` | JWT | Pay 50k fee (marks paid) |
| POST | `/api/provider/cancel-task/:taskId` | JWT | Cancel order with reason |
| GET | `/api/provider/tasks` | JWT | Provider active tasks |
| GET | `/api/provider/completed-tasks` | JWT | Provider completed tasks |
| POST | `/api/admin/providers/verify/:id` | JWT+Admin | Verify provider (creates notification) |
| POST | `/api/admin/providers/reject/:id` | JWT+Admin | Reject provider |
| POST | `/api/tracking/update` | JWT | Save GPS location for order |
| GET | `/api/tracking/:orderId` | JWT | Get other party's location |

## Session Anchored Summary (May 26, 2026 — PostgreSQL Migration Complete)

### Goal
Migrate from SQLite (sql.js) to PostgreSQL (Neon) for persistent data storage, fix provider earnings display.

### Completed May 26 (Full Day)
**Frontend fixes (index.html)**:
- `server.js` auto-payment & payment reminder provider lookups — 3 remaining `business_name`-only queries fixed
- All 33 empty catch blocks fixed (`catch(e) {}` → `catch(e) { console.warn(e); }`)
- Loading overlay added then removed (paid Render plan eliminates cold starts)
- `AbortSignal.timeout(35000)` added to all fetches in polling (prevents hanging)
- Chat notification routing fixed — task conversations notify the other party (customer↔provider), not always admin
- localStorage notification restore stopped — `globalNotifications` starts fresh each page load
- Provider earnings display fixed — `providerEarningsMap` now rebuilt during polling, not just initial load

**PostgreSQL Migration (backend)**:
- `src/database.js` — complete rewrite: `pg.Pool` wrapper with `StatementWrapper` class
  - Auto-converts `?` → `$N` placeholders so route SQL strings unchanged
  - `run()`, `get()`, `all()`, `pluck()` methods return Promises
  - Schema created via `CREATE TABLE IF NOT EXISTS` on startup (14 tables + indexes)
  - Admin account seeded automatically
- All 7 route files (`auth.js`, `admin.js`, `provider.js`, `customer.js`, `chat.js`, `reviews.js`, `tracking.js`) — every handler made `async`, every `db.prepare()` call got `await`
- SQLite-specific functions replaced: `datetime('now')` → `NOW()`, `strftime` → `to_char`, `DATE(x)=DATE('now')` → `x::date=CURRENT_DATE`
- `INSERT ... RETURNING id` replaces `result.lastInsertRowid` (customer.js place-order)
- `server.js` — startup wrapped in async IIFE, 3 setInterval callbacks made async
- `render.yaml` + `.env` — `DATABASE_URL` added with Neon connection string
- `seed.cjs` — database initialization only (no demo data)
- `package.json` — added `pg` dependency, `"seed"` script

### How It Works Now
- **Neon (serverless PostgreSQL)**: Free tier, 0.5 GB storage, 100 CU-hours/month, scales to zero when idle
- **Data persists across redeploys** — never lost when pushing to Render
- **Cold start**: ~500ms database wake from idle (vs 15s for Render free tier)
- **`result.changes` now accurate** — PostgreSQL's `rowCount` correctly reflects affected rows (the dead `{ changes: 1 }` bug is gone)
- All API routes remain at same paths, same request/response format — no frontend changes needed

### Outstanding Items (Tomorrow)
1. **Deploy to GitHub** — push backend + frontend to trigger Render + Netlify auto-deploy
2. **Configure real email delivery** — set MAIL_HOST/MAIL_USER env vars with SendGrid/Mailgun
3. **Password reset flow** — new backend route + UI
4. **Search/filter for services** — search bar across provider names, locations, categories

### Critical Context
- **DATABASE_URL** (Neon): `postgresql://neondb_owner:npg_j1DzgMkZf5UW@ep-rough-waterfall-altogw50.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require`
- **SSL warning**: pg v8 warns about `sslmode=require` being aliased to `verify-full`. Harmless. Fix permanently by changing to `sslmode=verify-full` in the connection string.
- Backend (Render): `https://havengo-backend.onrender.com`
- Frontend (Netlify): `https://havengo.netlify.app`
- GitHub Backend: `https://github.com/tituspeterson23-cmyk/havengo-backend` (branch `main`)
- GitHub Frontend: `https://github.com/tituspeterson23-cmyk/havengo-frontend` (branch `main`)
- Credentials: Admin `thermypetson@gmail.com` / `23.Forlife`
- Database now: **Neon PostgreSQL** (not SQLite in data/havengo.db)

## Session 5 (May 27, 2026) — Provider_id Anchoring, Notifications, Ratings

### Changes Made
- **Chat**: `sendChatMessage()` sends `"Provider"` instead of name; `normalizeChatSender()` maps old names → `"provider"`/`"admin"`/`"customer"`
- **All localStorage persistence removed** for chat (`syncChatToStorage`, localStorage fallback) and notifications (`userNotificationsMap`, `globalNotifications` on role switch)
- **Order contact details**: `GET /api/provider/tasks` joins `users`; `GET /api/admin/tasks` joins `users` + `providers`; frontend renders in booking/task cards
- **service_id TEXT**: Changed from `INTEGER` to `TEXT NOT NULL` in `tasks` and `price_requests` (PostgreSQL compat)
- **Provider earnings**: Uses `provider_id` instead of name matching in `customer.js` and `server.js`
- **System revenue**: `system_balance` key in `admin_settings` incremented on confirm-payment and auto-payment
- **Admin withdraw**: Already existed — fixed missing `apiUrl`/`headers` in frontend functions
- **Notifications persistence**: `fetchBackendNotifications()` no longer calls `mark-seen` immediately; marks seen only on panel open / "Mark all read"
- **Price requests**: `approvePriceRequest()`, `rejectPriceRequest()`, `adjustPriceRequest()` now call backend API; backends of approve/reject insert provider notifications
- **Booking status**: `fetchCustomerBookings()` checks `b.completed_at` for `"Completed"` status
- **Ratings**: `provider_ratings` table + `/api/provider-ratings` route; frontend fetches + submits via backend, 15s polling
- **Recent activities**: `renderProfilePage()` called on `navigateTo('profile')`
- **Mobile menu**: Added "How It Works" link
- **Job count**: Uses `COUNT(*) FROM completed_tasks WHERE provider_id = p.id` instead of earnings estimate
- **Provider_id matching**: Backend routes (`/tasks`, `/completed-tasks`, `/earnings`, `/dashboard-stats`) converted to `provider_id = ?` primary with name fallback; frontend task/completed objects capture `providerId`; filters match by ID first, name as fallback; `providerEarningsMap` keyed by both name and `"id_"+provider_id`
- **price_change_requests table**: Renamed to `price_requests` (matching route code); added migration fallback
- **renderAdminPriceRequests()**: Was accidentally deleted during edits — restored to fix JS parse error

### Fix Applied (May 27 evening)
- Missing `function renderAdminPriceRequests() {` declaration at HTML line ~3971 caused floating code, breaking JS parsing and preventing app from loading beyond home page

### Fix Applied (May 27 late)
**Cross-device price sync**:
- Added `service_prices` table (service_id TEXT PK, price INTEGER, provider_id, updated_at)
- Admin approve endpoint now upserts approved prices into `service_prices` via `ON CONFLICT DO UPDATE`
- Added `GET /api/services/prices` public endpoint returning all approved price overrides
- Created `fetchApprovedServicePrices()` frontend function — fetches and overrides hardcoded `services[]` basePrices
- Called on app init and every 15s polling for all users (not just admin)

**Provider order visibility hardening**:
- Initial task push in `enterProviderDashboard()` now includes `providerId: bt.provider_id || null`
- `placeOrder()` captures `providerId` from backend response (`orderData.providerId`) and stores in local `providerTasks` push and `bookings` push
- Backend `place-order` endpoint now returns `providerId` in response

### Deployment
- Both repos pushed to GitHub; Render + Netlify auto-deploy

## Session 6 (May 28, 2026) — Firebase Real-time Chat

### Changes
- **Backend**: Added Firebase Admin SDK (`src/firebase-admin.js`). Reads `service-account.json` at startup.
- **New endpoint**: `POST /api/auth/firebase-token` — generates a Firebase custom token from your JWT for Firestore auth.
- **Frontend**: Replaced polling-based chat (1.5s interval fetching `/api/chat/:id`) with Firestore `onSnapshot` real-time listeners.
- **Firestore collection**: `messages` — each doc has `conversationId`, `senderEmail`, `senderRole`, `senderName`, `text`, `participants[]`, `createdAt`.
- **Conversation ID patterns**: `customer-admin-{email}`, `provider-admin-{email}`, `task-{taskId}` (prefixed with `task-` for Firestore).
- **Privacy/isolation**: Firestore security rules (`firestore.rules`) enforce `request.auth.token.email in resource.data.participants`. Admin has global read. Write requires sender email match + participant membership.
- **Fallback**: If `service-account.json` is missing, the frontend silently falls back to the old backend polling (no errors).
- **`service-account.json`** is `.gitignore`'d — never commit it.
- **Text-only**: No voice, images, or file uploads in chat (per requirements).

### Private Chat Guarantee
| Scenario | Allowed? |
|---|---|
| Customer A reads task-5 (their order) | ✅ |
| Customer A reads task-6 (Customer B's order) | ❌ `participants` excludes A |
| Provider X reads provider-admin-X chat | ✅ |
| Provider X reads provider-admin-Y chat | ❌ `participants` excludes X |
| Customer A reads customer-admin-B chat | ❌ `participants` excludes A |
| Admin reads any conversation | ✅ `role == 'admin'` |

### Deploy Checklist
1. Create Firebase project → enable Firestore (test mode)
2. Enable Custom Authentication in Firebase Console
3. Copy Firebase config to `FIREBASE_CONFIG` in `index.html`
4. Download service account JSON → save as `service-account.json` in backend root
5. Deploy Firestore rules from `firestore.rules` to Firebase Console
6. Push both repos to GitHub (Render + Netlify auto-deploy)

### Key Files
- `firestore.rules` — Firestore security rules (enforce chat isolation)
- `src/firebase-admin.js` — Firebase Admin SDK init
- `src/routes/auth.js` — `/api/auth/firebase-token` endpoint
- `public/index.html` — Firebase config + `connectFirebaseChat()` + all Firestore chat functions

## Session 7 (May 30, 2026) — Notification Routing Fix + Web Push

### Root Cause
11 provider lookups used `WHERE business_name = ? OR firstname||' '||lastname = ?` (name-based matching). When multiple providers have similar names, or when provider_name in tasks differs from the stored name, notifications go to the wrong recipient.

### Fix: All 11 lookups replaced with `provider_id`
| File | Location | What changed |
|---|---|---|
| `src/routes/customer.js` | place-order, confirm-payment, report-payment-issue | Used `taskRow.provider_email` / `completed.provider_id` / `payment.provider_id` |
| `src/routes/admin.js` | notify-provider, resolve-payment-dispute (x2), tasks list JOIN, single task JOIN | `payment.provider_id`, accept `providerId` param, `t.provider_id = p.id` |
| `server.js` | payment reminder, auto-payment | `p.provider_id` / `payment.provider_id` |
| `src/routes/chat.js` | chat notification | `task.provider_email` directly |

### Web Push Notifications
- **`public/service-worker.js`** — Self-skipWaiting, activate, push (showNotification), notificationclick (focus/open)
- **`src/routes/push.js`** — VAPID key auto-generation stored in `admin_settings`, `GET /api/push/vapid-public-key` (public), `POST /api/push/subscribe` + `/unsubscribe` (JWT), `sendPushNotification()` export
- **`src/database.js`** — `push_subscriptions` table (user_email, endpoint, p256dh, auth)
- **`server.js`** — Mounts `/api/push`, calls `ensureVapidKeys()` on startup
- **`src/firestore-events.js`** — `emitNotification()` lazy-requires `sendPushNotification()` (no circular dep)
- **`index.html`** — `registerForPushNotifications()` called from customer login, provider login, admin login, and 2FA verify flows. Registers SW → requests permission → subscribes → sends to backend.

### Notification Display Polish
- Backend queries now `ORDER BY read ASC, created_at DESC LIMIT 50` (unread first, then history)
- `globalNotifications` and `userNotificationsMap` saved/restored in `buildAppState()`/`applyState()` (survives page reload)
- `userNotificationsMap` restored on customer login

### Deploy
- Backend: GitHub → Render (auto-deploy)
- Frontend: GitHub → Netlify (auto-deploy) + `npx firebase deploy --only hosting` → `https://havengo-chat.web.app`

### New Dependencies
- `web-push` — VAPID-based push notification delivery

## Important Constraints (NEVER break these)
- `index.html` is a single page — all JS, CSS, HTML in one file
- NEVER remove `userBalance = 2000000` default — it's the only safety net for users when backend is unreachable
- NEVER use `alert()` — always use `addInAppAlert(type, message)` 
- `userBalance` fallback: use `something !== undefined ? something : userBalance` NOT `something || userBalance` (preserves 0)
- Provider 50k fee: NO earnings credit, NO balance deduction — just simulate Mobile Money payment
- Signup: always clear `globalNotifications` before adding welcome notification
- Maps: Leaflet + OpenStreetMap tiles (free), Nominatim for search, `navigator.geolocation` for GPS
- Both repos must always be in sync (copy `public/index.html` to frontend repo root)
