// ============================================================
// HAVENGO UGANDA - CORE MODULE (state, utils, UI, nav, theme)
// ============================================================

// --- CONFIG ---
var HAVENGO_BACKEND_URL = "https://havengo-backend.onrender.com";

async function checkBackend() {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 30000);
    try {
        var r = await fetch(HAVENGO_BACKEND_URL + "/api/health", { method: "GET", cache: "no-store", signal: controller.signal });
        clearTimeout(timer);
        return r.ok;
    } catch(e) { clearTimeout(timer); return false; }
}

function handleSessionExpired() {
    if (window.__HAVENGO_JWT__) {
        window.__HAVENGO_JWT__ = null;
        currentUser = null;
        currentLoggedProvider = null;
        currentAdmin = null;
        globalNotifications = [];
        chatConversations = {};
        localStorage.removeItem("havengoState");
        localStorage.removeItem("havengoState_plain");
        try { localStorage.removeItem("encKey"); } catch(e) { console.warn(e); }
        addInAppAlert("error", "Your session has expired. Please login again.");
        navigateTo("home");
        updateProfileWithUser();
        renderProfilePage();
        renderAllProviderLists();
        updateNotifCount();
    }
}

// --- STATE ---
let currentUser = null;
let allUsers = [];
let userBalance = 2000000;
let userPaymentMethods = [];
let savedAddresses = [];
let favoriteProviders = [];
let pendingPayments = [];
let globalNotifications = [];
let userNotificationsMap = {};
let userActivity = [];
let chatConversations = {};
let signupVerificationData = null;
let currentChatTaskId = null;

let mapInstance = null;
let mapMarker = null;
let mapTrackWatchId = null;
let mapSelectedLat = null;
let mapSelectedLng = null;
let mapCallback = null;
let profilePicSrc = "https://images.unsplash.com/photo-1531123897720-8f129e1688f7?w=400";

let currentService = null;
let currentSelectedProvider = null;
let registeredProviders = [];
let currentLoggedProvider = null;
let selectedBitmoji = null;
let bookings = [];
let providerTasks = [];
let completedTasks = [];
let earnings = 0;
let providerEarningsMap = {};
let priceChangeRequests = [];
let deletionRequests = [];
let adminTasks = [];
let currentAdmin = null;
let adminRevenueData = null;

let userRatings = [];

// --- PERSISTENCE ---
var STORAGE_CIPHER_KEY = null;
async function getStorageCipherKey() {
    if (STORAGE_CIPHER_KEY) return STORAGE_CIPHER_KEY;
    var passphrase = "HavenGo-Uganda@2024!SecureStorage#Protect";
    var salt = "HavenGoStaticSalt2024";
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]);
    STORAGE_CIPHER_KEY = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode(salt), iterations: 50000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
    return STORAGE_CIPHER_KEY;
}
async function encryptAppStateJSON(json) {
    try {
        var key = await getStorageCipherKey();
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var enc = new TextEncoder();
        var encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(json));
        var combined = new Uint8Array(12 + encrypted.byteLength);
        combined.set(iv); combined.set(new Uint8Array(encrypted), 12);
        return btoa(String.fromCharCode.apply(null, combined));
    } catch(e) { return null; }
}
async function decryptAppStateJSON(ciphertext) {
    try {
        var key = await getStorageCipherKey();
        var combined = Uint8Array.from(atob(ciphertext), function(c) { return c.charCodeAt(0); });
        var decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12) }, key, combined.slice(12));
        return new TextDecoder().decode(decrypted);
    } catch(e) { return null; }
}
var _cryptoAvail = typeof crypto !== "undefined" && crypto.subtle && crypto.getRandomValues;
var _encryptPending = false;
async function _doEncryptSave() {
    if (_encryptPending) return;
    _encryptPending = true;
    try {
        var state = buildAppState();
        if (_cryptoAvail) {
            var encrypted = await encryptAppStateJSON(JSON.stringify(state));
            if (encrypted) {
                localStorage.setItem("havengoState", encrypted);
                localStorage.removeItem("havengoState_plain");
                return;
            }
        }
        localStorage.setItem("havengoState_plain", JSON.stringify(state));
    } catch(e) { console.warn(e); } finally { _encryptPending = false; }
}
function buildAppState() {
    return {
        currentUser: currentUser, allUsers: allUsers, userBalance: userBalance,
        userPaymentMethods: userPaymentMethods, savedAddresses: savedAddresses, favoriteProviders: favoriteProviders,
        pendingPayments: pendingPayments,
        userNotificationsMap: userNotificationsMap, userActivity: userActivity,
        profilePicSrc: profilePicSrc, customerBitmoji: customerBitmoji,
        registeredProviders: registeredProviders,
        bookings: bookings, providerTasks: providerTasks, completedTasks: completedTasks,
        earnings: earnings, providerEarningsMap: providerEarningsMap,
        priceChangeRequests: priceChangeRequests, deletionRequests: deletionRequests,
        userRatings: userRatings, reviews: reviews,
        hAvengoJwt: window.__HAVENGO_JWT__ || null,
        currentLoggedProvider: currentLoggedProvider,
        currentAdmin: currentAdmin,
        currentPage: window.__currentPage || null,
        providerTab: window.__providerTab !== undefined ? window.__providerTab : 0,
        adminTab: window.__adminTab !== undefined ? window.__adminTab : 0
    };
}
function saveAppState() {
    try {
        _doEncryptSave();
    } catch(e) { console.warn(e); }
}
async function loadAppState() {
    try {
        var raw = localStorage.getItem("havengoState");
        if (raw) {
            if (raw.charCodeAt(0) === 123) {
                applyState(JSON.parse(raw));
                return;
            }
            if (_cryptoAvail) {
                var decrypted = await decryptAppStateJSON(raw);
                if (decrypted) { applyState(JSON.parse(decrypted)); return; }
            }
        }
        var plain = localStorage.getItem("havengoState_plain");
        if (plain) { applyState(JSON.parse(plain)); return; }
    } catch(e) { console.warn(e); }
}

function applyState(state) {
    if (state.currentUser) currentUser = state.currentUser;
    if (state.allUsers) allUsers = state.allUsers;
    if (state.userBalance !== undefined) userBalance = state.userBalance;
    if (state.pendingPayments) pendingPayments = state.pendingPayments;
    if (state.userPaymentMethods) userPaymentMethods = state.userPaymentMethods;
    if (state.savedAddresses) savedAddresses = state.savedAddresses;
    if (state.favoriteProviders) favoriteProviders = state.favoriteProviders;
    if (state.userNotificationsMap) userNotificationsMap = state.userNotificationsMap;
    if (state.userActivity) userActivity = state.userActivity;
    if (state.profilePicSrc) profilePicSrc = state.profilePicSrc;
    if (state.customerBitmoji) customerBitmoji = state.customerBitmoji;
    if (state.registeredProviders) registeredProviders = state.registeredProviders;
    if (state.bookings) bookings = state.bookings;
    if (state.providerTasks) providerTasks = state.providerTasks;
    if (state.completedTasks) completedTasks = state.completedTasks;
    if (state.earnings !== undefined) earnings = state.earnings;
    if (state.providerEarningsMap) providerEarningsMap = state.providerEarningsMap;
    if (state.priceChangeRequests) priceChangeRequests = state.priceChangeRequests;
    if (state.deletionRequests) deletionRequests = state.deletionRequests;
    if (state.userRatings) userRatings = state.userRatings;
    if (state.reviews) reviews = state.reviews;
    if (state.hAvengoJwt) window.__HAVENGO_JWT__ = state.hAvengoJwt;
    if (state.currentLoggedProvider) currentLoggedProvider = state.currentLoggedProvider;
    if (state.currentAdmin) currentAdmin = state.currentAdmin;
    if (state.currentPage) window.__currentPage = state.currentPage;
    if (state.providerTab !== undefined) window.__providerTab = state.providerTab;
    if (state.adminTab !== undefined) window.__adminTab = state.adminTab;
}

let reviews = [];
let currentReviewStars = 0;

// Services
const services = [
    { id: "cleaning", name: "Deep Home Cleaning & Maintenance", basePrice: 85000, category: "cleaning" },
    { id: "spa", name: "Mobile Spa & Wellness", basePrice: 95000, category: "spa" },
    { id: "family", name: "Family & Pet Care", basePrice: 70000, category: "family" },
    { id: "errands", name: "Errands & Logistics", basePrice: 45000, category: "errands" },
    { id: "catering", name: "Catering & Ushering", basePrice: 150000, category: "catering" },
    { id: "kids", name: "Kids Activities & Tutoring", basePrice: 60000, category: "kids" },
    { id: "nursing", name: "Home Care Nursing", basePrice: 80000, category: "nursing" },
    { id: "appliance", name: "AC & Appliance Repair", basePrice: 55000, category: "appliance" },
    { id: "gardening", name: "Gardening & Landscaping", basePrice: 65000, category: "gardening" },
    { id: "hair", name: "Mobile Hair Styling", basePrice: 75000, category: "hair" },
    { id: "event", name: "Event Infrastructure Hire", basePrice: 250000, category: "event" },
    { id: "auto", name: "Mobile Auto Care & Detailing", basePrice: 65000, category: "auto" }
];

const serviceEmojis = {
    cleaning: "\uD83E\uDDF9", spa: "\uD83D\uDC86", family: "\uD83D\uDC76", errands: "\uD83D\uDCE6", catering: "\uD83C\uDF7D\uFE0F",
    kids: "\uD83C\uDFA8", nursing: "\uD83C\uDFE5", appliance: "\uD83D\uDD27", gardening: "\uD83C\uDF3F", hair: "\uD83D\uDC87", event: "\uD83C\uDFAA", auto: "\uD83D\uDE97"
};

function parseProviderServices(s) {
    if (!s) return [];
    if (Array.isArray(s)) {
        return s.map(function(ps) {
            if (typeof ps === 'string') {
                for (var ii = 0; ii < services.length; ii++) {
                    if (services[ii].name.toLowerCase() === ps.toLowerCase()) {
                        return { id: services[ii].id, name: services[ii].name, basePrice: services[ii].basePrice };
                    }
                }
                return { id: ps.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: ps, basePrice: 0 };
            }
            return { id: ps.id || ps.name.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: ps.name || '', basePrice: ps.basePrice || 0 };
        });
    }
    if (typeof s === 'string' && s.trim().startsWith('[')) {
        try {
            var parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map(function(name) {
                    name = (name.name || name).trim();
                    for (var ii = 0; ii < services.length; ii++) {
                        if (services[ii].name.toLowerCase() === name.toLowerCase()) {
                            return { id: services[ii].id, name: services[ii].name, basePrice: services[ii].basePrice };
                        }
                    }
                    return { id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: name, basePrice: 0 };
                });
            }
        } catch(e) { console.warn(e); }
    }
    return s.split(',').map(function(name) {
        name = name.trim();
        for (var i = 0; i < services.length; i++) {
            if (services[i].name.toLowerCase() === name.toLowerCase()) {
                return { id: services[i].id, name: services[i].name, basePrice: services[i].basePrice };
            }
        }
        return { id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'), name: name, basePrice: 0 };
    });
}

// Blog posts
const blogPosts = [
    { title: "Top 5 Home Cleaning Tips for Kampala Homes", date: "May 15, 2026", image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800", content: "Keep your home sparkling with these simple tips from HavenGo professionals. Regular dusting, using natural cleaners, and scheduling deep cleans monthly can transform your living space." },
    { title: "Why Mobile Spa Services Are Taking Over Uganda", date: "May 10, 2026", image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800", content: "The convenience of at-home wellness services has revolutionized self-care in Uganda. From professional massages to complete spa treatments, HavenGo brings luxury to your doorstep." }
];

const bitmojiOptions = ["\uD83D\uDC69\u200D\uD83D\uDD27", "\uD83D\uDC68\u200D\uD83D\uDD27", "\uD83E\uDDD1\u200D\uD83C\uDF73", "\uD83D\uDC69\u200D\uD83C\uDF73", "\uD83D\uDC68\u200D\uD83C\uDF73", "\uD83E\uDDF9", "\uD83E\uDDD1\u200D\uD83C\uDF3E", "\uD83D\uDC69\u200D\uD83D\uDCBC", "\uD83D\uDC68\u200D\uD83D\uDCBC", "\uD83E\uDDD1\u200D\uD83C\uDFA8", "\uD83D\uDC69\u200D\uD83C\uDFA8", "\uD83D\uDC68\u200D\uD83C\uDFA8", "\uD83E\uDDD1\u200D\uD83D\uDCBB", "\uD83D\uDC69\u200D\uD83D\uDCBB", "\uD83D\uDC68\u200D\uD83D\uDCBB", "\uD83D\uDC77", "\uD83D\uDC77\u200D\u2640\uFE0F", "\uD83D\uDC77\u200D\u2642\uFE0F", "\uD83E\uDDD1\u200D\uD83C\uDFEB", "\uD83D\uDC69\u200D\uD83C\uDFEB", "\uD83D\uDC68\u200D\uD83C\uDFEB", "\uD83E\uDDD1\u200D\u2695\uFE0F", "\uD83D\uDC69\u200D\u2695\uFE0F", "\uD83D\uDC68\u200D\u2695\uFE0F", "\uD83E\uDDD1\u200D\u2708\uFE0F", "\uD83D\uDC69\u200D\u2708\uFE0F", "\uD83D\uDC68\u200D\u2708\uFE0F", "\uD83C\uDFA8", "\uD83D\uDD27", "\uD83D\uDD29", "\uD83D\uDC6E", "\uD83D\uDC6E\u200D\u2642\uFE0F", "\uD83D\uDC6E\u200D\u2640\uFE0F", "\uD83D\uDC73", "\uD83D\uDC73\u200D\u2640\uFE0F", "\uD83D\uDC73\u200D\u2642\uFE0F", "\uD83E\uDDD4", "\uD83E\uDDD4\u200D\u2642\uFE0F", "\uD83E\uDDD4\u200D\u2640\uFE0F", "\uD83D\uDC81", "\uD83D\uDC81\u200D\u2642\uFE0F", "\uD83D\uDC81\u200D\u2640\uFE0F", "\uD83D\uDC87", "\uD83D\uDC87\u200D\u2642\uFE0F", "\uD83D\uDC87\u200D\u2640\uFE0F", "\uD83E\uDDD1", "\uD83D\uDC69", "\uD83D\uDC68", "\uD83D\uDC69\u200D\uD83E\uDDB0", "\uD83D\uDC68\u200D\uD83E\uDDB0", "\uD83D\uDC69\u200D\uD83E\uDDB1", "\uD83D\uDC68\u200D\uD83E\uDDB1", "\uD83D\uDC69\u200D\uD83E\uDDB3", "\uD83D\uDC68\u200D\uD83E\uDDB3", "\uD83E\uDDD1\u200D\uD83E\uDDB0", "\uD83E\uDDD1\u200D\uD83E\uDDB1", "\uD83E\uDDD1\u200D\uD83E\uDDB3", "\uD83E\uDDCD", "\uD83E\uDDCD\u200D\u2640\uFE0F", "\uD83E\uDDCD\u200D\u2642\uFE0F", "\uD83E\uDDCE", "\uD83E\uDDCE\u200D\u2640\uFE0F", "\uD83E\uDDCE\u200D\u2642\uFE0F", "\uD83D\uDC69\u200D\uD83E\uDDBD", "\uD83D\uDC68\u200D\uD83E\uDDBD", "\uD83D\uDC69\u200D\uD83E\uDDBC", "\uD83D\uDC68\u200D\uD83E\uDDBC", "\uD83D\uDC69\u200D\uD83E\uDDBE", "\uD83D\uDC68\u200D\uD83E\uDDBE", "\uD83E\uDDD1\u200D\uD83E\uDDBC", "\uD83E\uDDD1\u200D\uD83E\uDDBD", "\uD83E\uDDD1\u200D\uD83E\uDDBE", "\uD83D\uDCB0\u200D\uD83D\uDCB0", "\uD83D\uDCB0\u200D\uD83D\uDCB0", "\uD83D\uDCB0\u200D\uD83D\uDCB0", "\uD83D\uDCB0\u200D\uD83D\uDCB0", "\uD83D\uDCB0\u200D\uD83D\uDCB0"];
let customerBitmoji = null;

// --- AUTH UTILITIES ---
function showAuthModal(mode) {
    document.getElementById("auth-modal").classList.remove("hidden");
    switchAuthMode(mode || "login");
}

function closeAuthModal() {
    document.getElementById("auth-modal").classList.add("hidden");
    document.getElementById("login-identifier").value = "";
    document.getElementById("login-password").value = "";
}

function switchAuthMode(mode) {
    document.getElementById("login-form").classList.toggle("hidden", mode !== "login");
    document.getElementById("signup-form").classList.toggle("hidden", mode !== "signup");
    document.getElementById("auth-modal-title").textContent = mode === "signup" ? "Create Your Account" : "Welcome to HavenGo";
}

var ADMIN_PASSWORD_HASH = "7c6ce978996d699cebdba62fe7fbf011f6cba949d7861579d5c81f64deca0c79";

function sanitizeInput(str) {
    if (typeof str !== "string") return "";
    return str.replace(/[&<>"']/g, function(m) {
        if (m === "&") return "&amp;";
        if (m === "<") return "&lt;";
        if (m === ">") return "&gt;";
        if (m === '"') return "&quot;";
        if (m === "'") return "&#39;";
    });
}

function togglePasswordVisibility(id) {
    var input = document.getElementById(id);
    var icon = document.getElementById("eye-icon-" + id);
    if (!input || !icon) return;
    if (input.type === "password") {
        input.type = "text";
        icon.className = "fa-solid fa-eye-slash";
    } else {
        input.type = "password";
        icon.className = "fa-solid fa-eye";
    }
}

async function hashPassword(password) {
    if (typeof crypto !== "undefined" && crypto.subtle) {
        var encoder = new TextEncoder();
        var data = encoder.encode(password);
        var hashBuffer = await crypto.subtle.digest("SHA-256", data);
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
    var h = 0, i = 0, chr = 0;
    if (password.length > 0) {
        for (i = 0; i < password.length; i++) { chr = password.charCodeAt(i); h = ((h << 5) - h) + chr; h |= 0; }
    }
    return "fallback_" + Math.abs(h).toString(16).padStart(8, "0");
}

// --- UI COMPONENTS ---
function addInAppAlert(type, message) {
    var container = document.getElementById("app-alerts");
    if (!container) return;
    container.style.display = "flex";
    var colors = { success: "bg-emerald-600", error: "bg-red-500", info: "bg-blue-500", warning: "bg-amber-500" };
    var icons = { success: "fa-check-circle", error: "fa-exclamation-circle", info: "fa-info-circle", warning: "fa-exclamation-triangle" };
    var color = colors[type] || "bg-gray-700";
    var icon = icons[type] || "fa-bell";
    var alertEl = document.createElement("div");
    alertEl.className = color + " text-white px-5 py-3 rounded-2xl shadow-lg flex items-center gap-3 text-sm animate__fadeIn";
    alertEl.innerHTML = "<i class=\"fa-solid " + icon + "\"></i><span>" + message + "</span>";
    container.appendChild(alertEl);
    setTimeout(function() {
        alertEl.style.opacity = "0";
        alertEl.style.transition = "opacity 0.5s";
        setTimeout(function() { if (alertEl.parentNode) alertEl.parentNode.removeChild(alertEl); if (container.children.length === 0) container.style.display = "none"; }, 500);
    }, 4000);
}

var _appModalCallback = null;

function showAppConfirm(message, callback) {
    _appModalCallback = callback;
    var overlay = document.getElementById("app-confirm-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "app-confirm-overlay";
        overlay.className = "hidden fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-5";
        overlay.innerHTML = '<div class="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6"><p id="app-confirm-message" class="text-gray-700 mb-6 text-center"></p><div class="flex gap-3"><button id="app-confirm-yes" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-semibold">Yes</button><button id="app-confirm-no" class="flex-1 border border-gray-300 hover:bg-gray-50 py-3 rounded-xl font-semibold">No</button></div></div>';
        document.body.appendChild(overlay);
        document.getElementById("app-confirm-yes").onclick = function() { document.getElementById("app-confirm-overlay").classList.add("hidden"); if (_appModalCallback) _appModalCallback(true); _appModalCallback = null; };
        document.getElementById("app-confirm-no").onclick = function() { document.getElementById("app-confirm-overlay").classList.add("hidden"); if (_appModalCallback) _appModalCallback(false); _appModalCallback = null; };
    }
    document.getElementById("app-confirm-message").textContent = message;
    overlay.classList.remove("hidden");
}

function showAppPrompt(message, defaultVal, callback) {
    _appModalCallback = callback;
    var overlay = document.getElementById("app-prompt-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "app-prompt-overlay";
        overlay.className = "hidden fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-5";
        overlay.innerHTML = '<div class="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6"><p id="app-prompt-message" class="text-gray-700 mb-4 text-center"></p><input id="app-prompt-input" type="text" class="w-full border rounded-xl px-4 py-3 outline-none focus:border-emerald-500 mb-4"><div class="flex gap-3"><button id="app-prompt-ok" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-semibold">OK</button><button id="app-prompt-cancel" class="flex-1 border border-gray-300 hover:bg-gray-50 py-3 rounded-xl font-semibold">Cancel</button></div></div>';
        document.body.appendChild(overlay);
        document.getElementById("app-prompt-ok").onclick = function() { var val = document.getElementById("app-prompt-input").value; document.getElementById("app-prompt-overlay").classList.add("hidden"); if (_appModalCallback) _appModalCallback(val); _appModalCallback = null; };
        document.getElementById("app-prompt-cancel").onclick = function() { document.getElementById("app-prompt-overlay").classList.add("hidden"); if (_appModalCallback) _appModalCallback(null); _appModalCallback = null; };
    }
    document.getElementById("app-prompt-message").textContent = message;
    document.getElementById("app-prompt-input").value = defaultVal || "";
    overlay.classList.remove("hidden");
    document.getElementById("app-prompt-input").focus();
}

function addNotification(emoji, title, message, notifId) {
    cleanupOldNotifications();
    globalNotifications.unshift({
        emoji: emoji || "\uD83D\uDCE2",
        title: title || "Notification",
        message: message || "",
        time: new Date().toLocaleString(),
        read: false,
        timestamp: Date.now(),
        notifId: notifId
    });
    updateNotifCount();
}

function cleanupOldNotifications() {
    var now = Date.now();
    var oneDay = 24 * 60 * 60 * 1000;
    var twoWeeks = 14 * 24 * 60 * 60 * 1000;
    var filtered = [];
    for (var i = 0; i < globalNotifications.length; i++) {
        var n = globalNotifications[i];
        var age = now - (n.timestamp || 0);
        var isMoney = n.emoji === "\uD83D\uDCB0" || n.emoji === "\u2705" || n.emoji === "\uD83C\uDFE7" || (n.title && (n.title.indexOf("Payment") !== -1 || n.title.indexOf("Withdraw") !== -1 || n.title.indexOf("Deposit") !== -1));
        if (isMoney) {
            if (age < twoWeeks) filtered.push(n);
        } else {
            if (age < oneDay) filtered.push(n);
        }
    }
    globalNotifications = filtered;
}

function updateNotifCount() {
    var unread = 0;
    for (var i = 0; i < globalNotifications.length; i++) {
        if (!globalNotifications[i].read) unread++;
    }
    var el = document.getElementById("notif-count");
    if (el) {
        el.textContent = unread;
        el.classList.toggle("hidden", unread === 0);
    }
}

function showNotifications() {
    renderNotificationsModal();
    document.getElementById("notifications-modal").classList.remove("hidden");
}

function markAllRead() {
    for (var i = 0; i < globalNotifications.length; i++) {
        globalNotifications[i].read = true;
    }
    updateNotifCount();
    renderNotificationsModal();
    var pn = document.getElementById("profile-notifications");
    if (pn && !pn.closest(".hidden")) renderProfileNotifications();
}

function deleteNotification(index) {
    if (index < 0 || index >= globalNotifications.length) return;
    var notif = globalNotifications[index];
    globalNotifications.splice(index, 1);
    renderNotificationsModal();
    var pn = document.getElementById("profile-notifications");
    if (pn && !pn.closest(".hidden")) renderProfileNotifications();
    updateNotifCount();
    saveAppState();
    if (window.__HAVENGO_JWT__ && currentUser && notif.notifId) {
        fetch(HAVENGO_BACKEND_URL + "/api/customer/delete-notification/" + notif.notifId, {
            method: "POST",
            headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }
        }).catch(function(){});
    }
}

function renderNotificationsModal() {
    var list = document.getElementById("notifications-list");
    if (!list) return;
    if (globalNotifications.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-bell-slash text-4xl mb-3\"></i><p>No notifications yet</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < globalNotifications.length; i++) {
        var n = globalNotifications[i];
        var bgClass = n.read ? "bg-gray-50" : "bg-emerald-50 border border-emerald-200";
        var titleClass = n.read ? "" : "text-emerald-800";
        html += "<div class=\"p-4 rounded-2xl " + bgClass + "\">" +
            "<div class=\"flex items-start gap-3\">" +
            "<span class=\"text-2xl\">" + n.emoji + "</span>" +
            "<div class=\"flex-1\">" +
            "<p class=\"font-medium " + titleClass + "\">" + n.title + "</p>" +
            "<p class=\"text-sm text-gray-600\">" + n.message + "</p>" +
            "<p class=\"text-xs text-gray-400 mt-1\">" + n.time + "</p>" +
            "</div><button onclick=\"deleteNotification(" + i + ")\" class=\"text-red-400 hover:text-red-600 text-sm ml-2\"><i class=\"fa-solid fa-trash-can\"></i></button></div></div>";
    }
    list.innerHTML = html;
}

function renderProfileNotifications() {
    var container = document.getElementById("profile-notifications");
    if (!container) return;
    if (globalNotifications.length === 0) {
        container.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-bell-slash text-4xl mb-3\"></i><p>No notifications yet</p></div>";
        return;
    }
    var items = "";
    for (var i = 0; i < globalNotifications.length; i++) {
        var n = globalNotifications[i];
        var bgClass = n.read ? "bg-gray-50" : "bg-emerald-50";
        items += "<div class=\"p-3 rounded-2xl " + bgClass + "\">" +
            "<div class=\"flex items-start gap-3\">" +
            "<span class=\"text-xl\">" + n.emoji + "</span>" +
            "<div class=\"flex-1\">" +
            "<p class=\"font-medium text-sm\">" + n.title + "</p>" +
            "<p class=\"text-xs text-gray-600\">" + n.message + "</p>" +
            "<p class=\"text-xs text-gray-400 mt-1\">" + n.time + "</p>" +
            "</div><button onclick=\"deleteNotification(" + i + ")\" class=\"text-red-400 hover:text-red-600 text-sm ml-2\"><i class=\"fa-solid fa-trash-can\"></i></button></div></div>";
    }
    container.innerHTML = "<div class=\"flex justify-between items-center mb-4\">" +
        "<h3 class=\"font-semibold\">All Notifications</h3>" +
        "<button onclick=\"markAllRead()\" class=\"text-sm text-emerald-600 font-medium\">Mark all read</button></div>" +
        "<div class=\"space-y-3\">" + items + "</div>";
}

// --- NAVIGATION & THEME ---
function navigateTo(page) {
    var pages = document.querySelectorAll(".page");
    for (var i = 0; i < pages.length; i++) {
        pages[i].classList.remove("active");
    }
    var el = document.getElementById(page);
    if (el) el.classList.add("active");
    var mobileMenu = document.getElementById("mobile-menu");
    if (mobileMenu) mobileMenu.classList.add("menu-closed");
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.__currentPage = page;
    saveAppState();
    if (page === "bookings" && currentUser && window.__HAVENGO_JWT__) {
        fetchCustomerBookings();
    }
}

var menuManuallyOpened = false;

function toggleMenu() {
    var menu = document.getElementById("mobile-menu");
    if (menu) {
        var isOpening = menu.classList.contains("menu-closed");
        menu.classList.toggle("menu-closed");
        if (isOpening) {
            menuManuallyOpened = true;
            setTimeout(function() { menuManuallyOpened = false; }, 500);
        }
    }
}

window.addEventListener("scroll", function() {
    if (menuManuallyOpened) return;
    var menu = document.getElementById("mobile-menu");
    if (menu && !menu.classList.contains("menu-closed")) menu.classList.add("menu-closed");
}, { passive: true });

function toggleDarkMode() {
    document.documentElement.classList.toggle("dark");
    var stars = document.getElementById("stars-container");
    if (stars) {
        stars.classList.toggle("hidden");
        if (document.documentElement.classList.contains("dark") && !stars.querySelector(".star")) {
            createStars();
        }
    }
    localStorage.setItem("havengo-dark", document.documentElement.classList.contains("dark") ? "1" : "0");
}

function createStars() {
    var container = document.getElementById("stars-container");
    if (!container) return;
    container.innerHTML = "";
    for (var i = 0; i < 100; i++) {
        var star = document.createElement("div");
        star.className = "star";
        star.style.left = Math.random() * 100 + "%";
        star.style.top = Math.random() * 100 + "%";
        var size = (Math.random() * 3 + 1) + "px";
        star.style.width = size;
        star.style.height = size;
        star.style.animationDelay = Math.random() * 4 + "s";
        container.appendChild(star);
    }
    for (var i = 0; i < 2; i++) {
        spawnShootingStar(container);
    }
}

function spawnShootingStar(container) {
    var shooting = document.createElement("div");
    shooting.className = "shooting-star";
    shooting.style.left = Math.random() * 100 + "%";
    shooting.style.top = Math.random() * 50 + "%";
    shooting.style.animationDuration = (Math.random() * 1 + 0.8) + "s";
    container.appendChild(shooting);
    setTimeout(function() { if (shooting.parentNode) shooting.parentNode.removeChild(shooting); }, 2000);
}

setInterval(function() {
    var container = document.getElementById("stars-container");
    if (container && !container.classList.contains("hidden")) {
        spawnShootingStar(container);
    }
}, 4000);

// Core init — runs on DOMContentLoaded as a fallback
function _initCore() {
    if (localStorage.getItem("havengo-dark") === "1") {
        document.documentElement.classList.add("dark");
        var stars = document.getElementById("stars-container");
        if (stars) stars.classList.remove("hidden");
        createStars();
    }
    var savedTheme = localStorage.getItem("havengo-theme");
    if (savedTheme && savedTheme !== "default") {
        document.documentElement.classList.add("theme-" + savedTheme);
    }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _initCore);
} else {
    _initCore();
}

function toggleThemeMenu() {
    var menu = document.getElementById("theme-menu");
    if (menu) menu.classList.toggle("hidden");
}

function setTheme(theme) {
    document.documentElement.classList.remove("theme-ocean", "theme-rose", "theme-amber", "theme-indigo", "theme-violet", "theme-cyan", "theme-slate");
    if (theme !== "default") document.documentElement.classList.add("theme-" + theme);
    var menu = document.getElementById("theme-menu");
    if (menu) menu.classList.add("hidden");
    localStorage.setItem("havengo-theme", theme);
}
