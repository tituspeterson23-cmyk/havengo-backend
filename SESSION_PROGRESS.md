# HavenGo Session — May 30, 2026

## Changes Made This Session

### 1. npm audit fix — Security Patches
- **nodemailer**: `^6.10.1` → `^8.0.9` (fixes high severity: email injection, DoS, SMTP command injection)
- **uuid**: `^10.0.0` → `^14.0.0` (buffer bounds check fix)
- Created `KNOWN_VULNERABILITIES.md` — documents 8 remaining moderate vulns in transitive deps of firebase-admin
- Created `SECURITY_FIXES_SUMMARY.txt` — summary of fixes applied
- **Committed & Pushed**: `20dcd60` → both backend (`main`) and frontend repos

### 2. On-Screen Pop-Up Alerts for Backend Notifications
- Modified `fetchBackendNotifications()` in `public/index.html` to show `addInAppAlert` toasts for new backend notifications
- On page load: existing notifications are added to bell icon silently (no popup flood)
- On subsequent fetches (polling): new notifications trigger a toast popup at top-right regardless of which page/section user is on
- Works for all roles: admin, customer, and provider
- Uses `_notifInitialFetch` flag to distinguish first load from polling updates
- **Committed & Pushed**: `55704e2` (backend) + `2ef4cf6` (frontend)

### 3. Health Check Results
- **Frontend** (Netlify `havengo.netlify.app` & Firebase `havengo-chat.web.app`): ✅ UP
- **Backend** (Render `havengo-backend.onrender.com`): ❌ DOWN — completely unresponsive, all endpoints transport error
- **Render Status**: All Systems Operational (render.com status page) — issue is specific to the havengo-backend service
- **Local test**: Server starts successfully with Neon PostgreSQL connection

### 4. New Services: Laundry, Water Delivery, Phone Fix
- **Laundry & Dry Cleaning** (`category: "laundry"`, basePrice: 35,000): Load type (standard/large), service type (wash/dryclean/both), dynamic pricing
- **Drinking Water Delivery** (`category: "water"`, basePrice: 15,000): Jerrycan count (1-50), express option (+20%), bulk discount (5+ jerrycans = 10% off)
- **Phone/Tablet Fix**: Added to Appliance Repair select (45,000 UGX)
- Added to `services` array, `serviceEmojis` map, `renderAllProviderLists()`, `renderDynamicFields()`, `calculateDynamicPrice()`

### 5. Services UI Modernization
- Converted static HTML service cards to dynamic `renderServices()` function driven by `services` array + `serviceMeta` metadata
- **Search bar**: Real-time text filter on service name and description
- **Category filter**: Dynamic dropdown populated from all unique categories
- **Staggered fade-in animations**: Each card animates in with incremental delay (0s → 0.65s)
- **Hover effects**: Cards lift (-translate-y-1) with stronger shadow on hover
- Same card appearance preserved (images, descriptions, badges, prices, ratings)

### 6. Monthly Subscription Feature (Online/Backend-Driven)
- Rewrote subscription system from localStorage → backend API calls with localStorage fallback
- New **Subscription** profile tab (index 6, crown icon)
- Per-service monthly recurring subscription with 10% discount
- API: `POST /customer/subscriptions/create`, `POST /customer/subscriptions/cancel`, `GET /customer/subscriptions`
- Backend `subscriptions` table: user_email, service_id, service_name, plan, amount, discount_percent, status, next_billing_at, cancelled_at

### 7. Loyalty Points System
- Added `loyalty_points` column to `users` table
- Points awarded on payment confirm: `Math.floor(completed.price / 10000)` points
- `redeemable_gifts` table with 4 gifts: Mug (50pts), Jumper (200pts), Service Voucher (150pts), Lifetime Discount Badge (500pts)
- `loyalty_redemptions` table tracking user redemptions
- API: `GET /customer/loyalty-points`, `GET /customer/gifts`, `GET /customer/redemptions`, `POST /customer/redeem-gift`
- Frontend: loyalty points stat card in profile overview, gift grid with affordability check, redemption history in subscription tab

### 8. Admin Portal — Subscriptions & Customer Count
- Admin dashboard: **Total Customers** stat card (allUsers.length), **Active Subscriptions** stat card
- New **Subscriptions** admin tab (index 6) with `renderAdminSubscriptions()`
- Lists all subscriptions with status badge (Active/Cancelled), plan, amount, discount, next billing date
- Admin route `GET /admin/subscriptions` returns all subscriptions
- `GET /admin/dashboard-stats` now includes `totalCustomers` and `totalSubscriptions`

### 9. Water Image & Other Fixes
- Water delivery image changed to show actual water jerrycan delivery
- `switchAdminTab()` extended to handle tab 6 → `renderAdminSubscriptions()`
- `_syncAdminData()` fetches subscriptions from backend
- `adminSubscriptions` state variable added

### 10. Committed & Pushed
- **Backend**: `cca8422` → pushed to GitHub (`main`)
- **Frontend**: `e4ae526` → pushed to GitHub (`main`)
- index.html synced (backend → frontend) via Copy-Item

### What Still Needs User Action
1. Check Render Dashboard for deploy logs / trigger manual deploy
2. Set `FIREBASE_SERVICE_ACCOUNT_BASE64` env var in Render Dashboard
3. Enable Email/Password in Firebase Console Authentication
4. Paste Firestore rules in Firebase Console
