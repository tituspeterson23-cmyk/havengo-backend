// ============================================================
// HAVENGO UGANDA - APP FUNCTIONS (Customer, Provider, Admin, Maps, etc.)
// ============================================================
// This file is loaded after core.js

// ============================================================
// FORGOT / RESET PASSWORD
// ============================================================

function showForgotPassword() {
    closeAuthModal();
    document.getElementById("forgot-password-form").classList.remove("hidden");
    document.getElementById("forgot-password-success").classList.add("hidden");
    document.getElementById("forgot-password-modal").classList.remove("hidden");
    document.getElementById("forgot-email").value = "";
}

function hideForgotPassword() {
    document.getElementById("forgot-password-modal").classList.add("hidden");
}

async function submitForgotPassword() {
    var email = document.getElementById("forgot-email").value.trim();
    if (!email) {
        addInAppAlert("error", "Please enter your email address");
        return;
    }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
        addInAppAlert("error", "Please enter a valid email address");
        return;
    }
    var btn = document.querySelector("#forgot-password-form button");
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Sending...';
    try {
        var resp = await fetch(HAVENGO_BACKEND_URL + "/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email })
        });
        var data = await resp.json();
        if (data.success) {
            document.getElementById("forgot-password-form").classList.add("hidden");
            document.getElementById("forgot-password-success").classList.remove("hidden");
        } else {
            addInAppAlert("error", data.error || "Failed to send reset link");
        }
    } catch(e) {
        addInAppAlert("error", "Server unavailable. Please try again later.");
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane mr-2"></i>Send Reset Link';
}

async function submitResetPassword() {
    var password = document.getElementById("reset-password").value;
    var confirm = document.getElementById("reset-password-confirm").value;
    if (!password || !confirm) {
        addInAppAlert("error", "Please fill in both password fields");
        return;
    }
    if (password.length < 6) {
        addInAppAlert("error", "Password must be at least 6 characters");
        return;
    }
    if (password !== confirm) {
        addInAppAlert("error", "Passwords do not match");
        return;
    }
    var params = new URLSearchParams(window.location.search);
    var token = params.get("token");
    var email = params.get("email");
    if (!token || !email) {
        addInAppAlert("error", "Invalid reset link. Missing token or email.");
        return;
    }
    var btn = document.querySelector("#reset-password-form button");
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Resetting...';
    try {
        var resp = await fetch(HAVENGO_BACKEND_URL + "/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token, email: email, password: password })
        });
        var data = await resp.json();
        if (data.success) {
            document.getElementById("reset-password-form").classList.add("hidden");
            document.getElementById("reset-password-success").classList.remove("hidden");
            document.getElementById("reset-password-error").classList.add("hidden");
            // Clear query params
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            document.getElementById("reset-password-form").classList.add("hidden");
            document.getElementById("reset-password-error").classList.remove("hidden");
            document.getElementById("reset-password-error-msg").textContent = data.error || "This reset link is invalid or has expired.";
            document.getElementById("reset-password-success").classList.add("hidden");
        }
    } catch(e) {
        addInAppAlert("error", "Server unavailable. Please try again later.");
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>Reset Password';
}

async function performSignup() {
    const firstname = sanitizeInput(document.getElementById("signup-firstname").value.trim());
    const lastname = sanitizeInput(document.getElementById("signup-lastname").value.trim());
    const phone = sanitizeInput(document.getElementById("signup-phone").value.trim());
    const email = sanitizeInput(document.getElementById("signup-email").value.trim());
    const password = document.getElementById("signup-password").value;
    const confirm = document.getElementById("signup-confirm-password").value;

    if (!firstname || !lastname || !phone || !email || !password) {
        addInAppAlert("error", "Please fill in all fields");
        return;
    }
    if (password !== confirm) {
        addInAppAlert("error", "Passwords do not match");
        return;
    }
    if (password.length < 6) {
        addInAppAlert("error", "Password must be at least 6 characters");
        return;
    }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
        addInAppAlert("error", "Please enter a valid email address");
        return;
    }

    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    var backendOk = await checkBackend();

    if (!backendOk) {
        addInAppAlert("error", "Server is currently unavailable. Please try again later.");
        return;
    }

    // Generate verification code locally (no email system) and show it immediately
    var generatedCode = Math.floor(100000 + Math.random() * 900000).toString();
    document.getElementById("signup-submit-btn").disabled = true;
    document.getElementById("signup-submit-btn").innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Code...';
    signupVerificationData = { firstname: firstname, lastname: lastname, phone: phone, email: email, password: password, code: generatedCode };
    var codeDisplay = document.getElementById("display-verification-code");
    if (codeDisplay) codeDisplay.textContent = generatedCode;
    var codeInput = document.getElementById("verification-code");
    if (codeInput) {
        codeInput.value = generatedCode;
        codeInput.readOnly = true;
        codeInput.classList.add("bg-gray-50", "text-emerald-700", "font-bold");
    }
    document.getElementById("verification-section").classList.remove("hidden");
    document.getElementById("signup-submit-btn").classList.add("hidden");
    if (codeInput) codeInput.focus();
    addInAppAlert("info", "\u2709\uFE0F Your verification code: " + generatedCode);
    // Auto-verify after a brief moment so the user can see the code
    setTimeout(function() {
        if (document.getElementById("verification-section") && !document.getElementById("verification-section").classList.contains("hidden")) {
            verifySignupCode();
        }
    }, 800);
    // Also send to backend so future email/SMS integration works
    try {
        await fetch(apiUrl + "/auth/send-verification-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: email, type: "email", code: generatedCode })
        });
    } catch(e) { console.warn(e); }
}

async function verifySignupCode() {
    if (window.__HAVENGO_VERIFYING__) return;
    window.__HAVENGO_VERIFYING__ = true;
    var code = document.getElementById("verification-code").value.trim();
    if (!code || code.length !== 6) {
        window.__HAVENGO_VERIFYING__ = false;
        addInAppAlert("error", "Please enter the 6-digit verification code");
        return;
    }
    if (!signupVerificationData) { window.__HAVENGO_VERIFYING__ = false; addInAppAlert("error", "Session expired. Please start signup again."); return; }

    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    document.getElementById("verify-code-btn").disabled = true;
    document.getElementById("verify-code-btn").innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    // Try backend verification first, fall back to local comparison
    var verified = false;
    try {
        var verifyResp = await fetch(apiUrl + "/auth/verify-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: signupVerificationData.email, code: code })
        });
        var verifyData = await verifyResp.json();
        verified = verifyData.success;
    } catch(e) { console.warn(e); }
    if (!verified) {
        if (code === signupVerificationData.code) {
            verified = true;
        } else {
            window.__HAVENGO_VERIFYING__ = false;
            addInAppAlert("error", "Invalid verification code");
            document.getElementById("verify-code-btn").disabled = false;
            document.getElementById("verify-code-btn").innerHTML = "Verify";
            return;
        }
    }

    // Code verified — complete registration
    try {
        var regResp = await fetch(apiUrl + "/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                firstname: signupVerificationData.firstname, lastname: signupVerificationData.lastname,
                phone: signupVerificationData.phone, email: signupVerificationData.email,
                password: signupVerificationData.password, skipVerification: true
            })
        });
        var regData = await regResp.json();
        if (regData.success) {
            window.__HAVENGO_VERIFYING__ = false;
            currentUser = regData.user;
            window.__HAVENGO_JWT__ = regData.token;
            userBalance = regData.user.balance !== undefined ? regData.user.balance : 2000000;
            closeAuthModal();
            updateProfileWithUser();
            renderProfilePage();
            updateProfilePicCursor();
            globalNotifications = [];
            addNotification("\uD83C\uDF89", "Account Created", "Welcome to HavenGo, " + signupVerificationData.firstname + "!");
            fetchBackendNotifications();
            fetchPendingPayments();
            startAutoPaymentCheck();
            addActivity("signup", "Created your HavenGo account");
            addInAppAlert("success", "Account created successfully! Welcome " + signupVerificationData.firstname + "!");
            saveAppState();
            signupVerificationData = null;
            document.getElementById("signup-firstname").value = "";
            document.getElementById("signup-lastname").value = "";
            document.getElementById("signup-phone").value = "";
            document.getElementById("signup-email").value = "";
            document.getElementById("signup-password").value = "";
            document.getElementById("signup-confirm-password").value = "";
            return;
        }
        if (regData.error) { addInAppAlert("error", regData.error); }
    } catch(e) {
        addInAppAlert("error", "Registration failed. Please try again.");
    }
    window.__HAVENGO_VERIFYING__ = false;
    document.getElementById("verify-code-btn").disabled = false;
    document.getElementById("verify-code-btn").innerHTML = "Verify";
}

async function resendSignupCode() {
    if (!signupVerificationData) { addInAppAlert("error", "Session expired. Please start signup again."); return; }
    document.getElementById("resend-code-btn").disabled = true;
    document.getElementById("resend-code-btn").innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    // Regenerate code locally
    var newCode = Math.floor(100000 + Math.random() * 900000).toString();
    signupVerificationData.code = newCode;
    var codeDisplay = document.getElementById("display-verification-code");
    if (codeDisplay) codeDisplay.textContent = newCode;
    var codeInput = document.getElementById("verification-code");
    if (codeInput) {
        codeInput.value = newCode;
        codeInput.readOnly = true;
    }
    addInAppAlert("info", "\u2709\uFE0F New verification code: " + newCode);
    try {
        var resp = await fetch(HAVENGO_BACKEND_URL + "/api/auth/send-verification-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: signupVerificationData.email, type: "email", code: newCode })
        });
        var data = await resp.json();
    } catch(e) { console.warn(e); }
    document.getElementById("resend-code-btn").disabled = false;
    document.getElementById("resend-code-btn").innerHTML = "Get new code";
    addInAppAlert("success", "New verification code generated");
    // Auto-verify again
    setTimeout(function() {
        if (document.getElementById("verification-section") && !document.getElementById("verification-section").classList.contains("hidden")) {
            verifySignupCode();
        }
    }, 800);
    document.getElementById("resend-code-btn").innerHTML = "Resend";
}

async function performLogin() {
    var identifier = sanitizeInput(document.getElementById("login-identifier").value.trim());
    var password = document.getElementById("login-password").value;

    if (!identifier || !password) {
        addInAppAlert("error", "Please enter your credentials");
        return;
    }

    var isAdminCred = identifier === "thermypetson@gmail.com" || identifier === "0757532066";

    var apiUrl = HAVENGO_BACKEND_URL + "/api";

    // For admin credentials, try admin login first
    if (isAdminCred) {
        try {
            var adminResp = await fetch(apiUrl + "/auth/admin/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: identifier, password: password }),
                signal: AbortSignal.timeout(35000)
            });
            var adminData = await adminResp.json();
            if (adminData.success) {
                window.__HAVENGO_JWT__ = adminData.token;
                closeAuthModal();
                adminLoginSuccess();
                return;
            }
        } catch(e) { console.warn(e); }
    }

    // Customer login
    try {
        var resp = await fetch(apiUrl + "/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: identifier, password: password }),
            signal: AbortSignal.timeout(35000)
        });
        var data = await resp.json();
        if (data.success) {
            currentUser = data.user;
            window.__HAVENGO_JWT__ = data.token;
            userBalance = data.user.balance !== undefined ? data.user.balance : userBalance;
            closeAuthModal();
            updateProfileWithUser();
            renderProfilePage();
            updateProfilePicCursor();
            addNotification("\uD83D\uDD13", "Logged In", "Welcome back, " + data.user.firstname + "!");
            fetchBackendNotifications();
            saveAppState();
            startAutoPaymentCheck();
            fetchPendingPayments();
            return;
        }
        if (data.user_not_found) {
            addInAppAlert("error", "Your account no longer exists on the server. Please sign up again.");
            return;
        }
        if (data.error) {
            addInAppAlert("error", data.error);
            return;
        }
    } catch(e) {
        addInAppAlert("error", "Cannot log in: Server is currently unavailable. Please try again later.");
        return;
    }
    addInAppAlert("error", "Cannot log in: Server is currently unavailable. Please try again later.");
}

function logout(skipConfirm) {
    function doLogout() {
        if (currentUser && currentUser.email) {
            userNotificationsMap[currentUser.email] = globalNotifications.slice();
        }
        globalNotifications = [];
        userActivity = [];
        window.__HAVENGO_JWT__ = null;
        currentUser = null;
        userBalance = 2000000;
        chatConversations = {};
        var ks = document.getElementById("keep-session"); if (!ks || !ks.checked) saveAppState();
        closeModal("settings-modal");
        updateProfileWithUser();
        navigateTo("home");
        addInAppAlert("info", "Logged out successfully");
        renderAllProviderLists();
        updateProfilePicCursor();
        updateNotifCount();
    }
    if (skipConfirm) { doLogout(); return; }
    showAppConfirm("Are you sure you want to logout?", function(confirmed) {
        if (!confirmed) return;
        doLogout();
    });
}

function updateProfileWithUser() {
    var fullnameEl = document.getElementById("profile-fullname");
    var emailEl = document.getElementById("profile-email");
    var phoneEl = document.getElementById("profile-phone");
    var authBtn = document.getElementById("profile-auth-button");

    if (currentUser) {
        fullnameEl.textContent = currentUser.name || currentUser.firstname + " " + currentUser.lastname;
        emailEl.textContent = currentUser.email || "No email provided";
        phoneEl.textContent = currentUser.phone || "No phone provided";
        authBtn.innerHTML = "<i class=\"fa-solid fa-right-from-bracket\"></i> Log Out";
        authBtn.onclick = function() { logout(); };
    } else {
        fullnameEl.textContent = "Guest User";
        emailEl.textContent = "guest@havengo.ug";
        phoneEl.textContent = "+256 777 062 518";
        authBtn.innerHTML = "<i class=\"fa-solid fa-right-to-bracket\"></i> Log In";
        authBtn.onclick = function() { showAuthModal("login"); };
    }
}

function handleProfileAuthButton() {
    if (currentUser) {
        logout();
    } else {
        showAuthModal("login");
    }
}

function requestAccountDeletion() {
    if (!currentUser) return;
    var identifier = currentUser.email || currentUser.phone;
    if (!identifier) return;
    showAppConfirm("Are you sure? Your account will be permanently deleted in 15 days. Log in within 15 days to cancel deletion.", function(confirmed) {
        if (!confirmed) return;
        var existing = -1;
        for (var i = 0; i < deletionRequests.length; i++) {
            if (deletionRequests[i].identifier === identifier) { existing = i; break; }
        }
        if (existing !== -1) {
            deletionRequests[existing].requestedAt = Date.now();
        } else {
            deletionRequests.push({ identifier: identifier, requestedAt: Date.now() });
        }
        userActivity = [];
        addNotification("\uD83D\uDDD1\uFE0F", "Account Deletion Scheduled", "Your account will be permanently deleted in 15 days. Log in to cancel.");
        addInAppAlert("info", "Deletion scheduled. Your account will be permanently deleted in 15 days.");
        saveAppState();
        logout(true);
    });
}

function requestProviderAccountDeletion() {
    if (!currentLoggedProvider) return;
    var identifier = currentLoggedProvider.email || currentLoggedProvider.phone;
    if (!identifier) return;
    showAppConfirm("Are you sure? Your account will be permanently deleted in 15 days. Log in within 15 days to cancel deletion.", function(confirmed) {
        if (!confirmed) return;

        // Call backend API for immediate removal
        (async function() {
            var jwt = window.__HAVENGO_JWT__;
            if (jwt) {
                try {
                    await fetch(HAVENGO_BACKEND_URL + "/api/provider/account", {
                        method: "DELETE", headers: { "Authorization": "Bearer " + jwt }
                    });
                } catch(e) { console.warn(e); }
            }
        })();

        // Remove from local registeredProviders immediately
        for (var ri = registeredProviders.length - 1; ri >= 0; ri--) {
            if (registeredProviders[ri].email === currentLoggedProvider.email) {
                registeredProviders.splice(ri, 1);
            }
        }
        renderAllProviderLists();

    var existing = -1;
    for (var i = 0; i < deletionRequests.length; i++) {
        if (deletionRequests[i].identifier === identifier) { existing = i; break; }
    }
    if (existing !== -1) {
        deletionRequests[existing].requestedAt = Date.now();
    } else {
        deletionRequests.push({ identifier: identifier, requestedAt: Date.now() });
    }
    userActivity = [];
    addNotification("\uD83D\uDDD1\uFE0F", "Account Deletion Scheduled", currentLoggedProvider.name + "'s account will be permanently deleted in 15 days.");
    addInAppAlert("info", "Deletion scheduled. Your account will be permanently deleted in 15 days.");
    if (currentLoggedProvider && currentLoggedProvider.email) {
        userNotificationsMap[currentLoggedProvider.email] = globalNotifications.slice();
    }
    if (window.__providerPollInterval) clearInterval(window.__providerPollInterval);
    currentLoggedProvider = null;
    globalNotifications = [];
    document.getElementById("provider-login-screen").classList.remove("hidden");
    document.getElementById("provider-dashboard").classList.add("hidden");
    document.getElementById("provider-header").classList.add("hidden");
    document.getElementById("prov-login-id").value = "";
    document.getElementById("prov-login-pass").value = "";
    saveAppState();
    });
}

function checkAccountDeletionOnLogin(identifier) {
    if (!identifier) return;
    for (var i = 0; i < deletionRequests.length; i++) {
        if (deletionRequests[i].identifier === identifier) {
            deletionRequests.splice(i, 1);
            addNotification("\uD83C\uDF89", "Account Restored", "Your account deletion has been cancelled. Welcome back!");
            saveAppState();
            return;
        }
    }
}

function processExpiredDeletions() {
    var now = Date.now();
    var fifteenDays = 15 * 24 * 60 * 60 * 1000;
    var changed = false;
    for (var i = deletionRequests.length - 1; i >= 0; i--) {
        if (now - deletionRequests[i].requestedAt >= fifteenDays) {
            var id = deletionRequests[i].identifier;
            for (var j = registeredProviders.length - 1; j >= 0; j--) {
                if (registeredProviders[j].email === id || registeredProviders[j].phone === id) {
                    registeredProviders.splice(j, 1);
                    changed = true;
                    break;
                }
            }
            deletionRequests.splice(i, 1);
        }
    }
    if (changed) {
        renderAdminDashboard();
        renderAllProviderLists();
        saveAppState();
    }
}

// ============================================================
// LIVE MAPS — Leaflet + OpenStreetMap
// ============================================================

function openMapModal(title, lat, lng, callback) {
    mapCallback = callback || null;
    document.getElementById("map-title-text").textContent = title || "Location Map";
    document.getElementById("map-modal").classList.remove("hidden");
    document.getElementById("map-search-box").classList.remove("hidden");
    document.getElementById("map-location-info").classList.add("hidden");
    document.getElementById("map-track-btn").classList.add("hidden");
    document.getElementById("map-pin-btn").classList.remove("hidden");
    document.getElementById("map-pin-btn").innerHTML = '<i class="fa-solid fa-check"></i> Confirm Location';
    setTimeout(function() { initMap(lat, lng); }, 300);
}

function closeMapModal() {
    if (mapTrackWatchId !== null) { navigator.geolocation.clearWatch(mapTrackWatchId); mapTrackWatchId = null; }
    document.getElementById("map-modal").classList.add("hidden");
    if (mapInstance) { mapInstance.remove(); mapInstance = null; mapMarker = null; }
    mapSelectedLat = null; mapSelectedLng = null; mapCallback = null;
}

function initMap(lat, lng) {
    if (mapInstance) { mapInstance.remove(); mapInstance = null; mapMarker = null; }
    var defaultLat = lat || 0.3476;
    var defaultLng = lng || 32.5825;
    mapInstance = L.map("map-container").setView([defaultLat, defaultLng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "&copy; <a href='https://openstreetmap.org/copyright'>OpenStreetMap</a>"
    }).addTo(mapInstance);
    mapMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(mapInstance);
    mapSelectedLat = defaultLat; mapSelectedLng = defaultLng;
    mapMarker.on("dragend", function() {
        var pos = mapMarker.getLatLng();
        mapSelectedLat = pos.lat; mapSelectedLng = pos.lng;
        updateMapCoords(pos.lat, pos.lng);
    });
    // Request GPS location — browser will prompt user
    if (!lat) {
        requestGpsPermission();
    }
    updateMapCoords(defaultLat, defaultLng);
    setTimeout(function() { mapInstance.invalidateSize(); }, 500);
}

function requestGpsPermission() {
    if (!navigator.geolocation) { addInAppAlert("error", "GPS not supported on this device"); return; }
    var btn = document.getElementById("map-track-btn");
    if (btn) {
        btn.classList.remove("hidden");
        btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> Enable Location';
        btn.onclick = function() {
            getGpsLocation(true);
            btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> Location Enabled';
            btn.disabled = true;
            btn.classList.add("opacity-50");
            // Start live tracking after enabling
            startMapTracking();
        };
    }
}

function getGpsLocation(panTo) {
    if (!navigator.geolocation) { addInAppAlert("error", "GPS not supported on this device"); return; }
    navigator.geolocation.getCurrentPosition(function(pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (mapInstance) {
            if (panTo !== false) mapInstance.setView([lat, lng], 15);
            if (mapMarker) {
                mapMarker.setLatLng([lat, lng]);
                mapSelectedLat = lat; mapSelectedLng = lng;
                updateMapCoords(lat, lng);
            }
        }
    }, function(err) {
        if (err.code === 1) {
            addInAppAlert("warning", "Location access denied. Enable it in your browser settings to use live map features.");
        } else if (err.code === 2) {
            addInAppAlert("error", "GPS signal unavailable. Try moving to an open area.");
        } else if (err.code === 3) {
            addInAppAlert("info", "Waiting for GPS signal... Click 'Enable Location' to try again.");
        }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

function updateMapCoords(lat, lng) {
    var info = document.getElementById("map-location-info");
    if (info) info.classList.remove("hidden");
    var coordsEl = document.getElementById("map-coords");
    if (coordsEl) coordsEl.textContent = lat.toFixed(6) + ", " + lng.toFixed(6);
    var distEl = document.getElementById("map-eta");
    // Estimate ETA from Kampala center for reference
    var kampalaLat = 0.3476, kampalaLng = 32.5825;
    var d = calcDistance(lat, lng, kampalaLat, kampalaLng);
    if (d < 1) { distEl.textContent = "Local area"; }
    else { var mins = Math.round(d * 2); distEl.textContent = "~" + mins + " min away \u2022 " + d.toFixed(1) + " km"; }
}

function calcDistance(lat1, lng1, lat2, lng2) {
    var R = 6371; var dLat = (lat2 - lat1) * Math.PI / 180; var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c;
}

async function searchOnMap() {
    var query = document.getElementById("map-search-input").value.trim();
    if (!query) return;
    try {
        var resp = await fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(query) + "&limit=5&countrycodes=UG");
        var results = await resp.json();
        var list = document.getElementById("map-search-results");
        list.classList.remove("hidden");
        if (!results || results.length === 0) { list.innerHTML = "<div class='p-3 text-gray-500'>No results found</div>"; return; }
        var html = "";
        for (var i = 0; i < results.length; i++) {
            html += "<div onclick=\"selectMapResult(" + results[i].lat + "," + results[i].lon + ",'" + results[i].display_name.replace(/'/g,"\\'") + "')\" class=\"p-3 hover:bg-gray-100 cursor-pointer border-b text-sm\">" + results[i].display_name + "</div>";
        }
        list.innerHTML = html;
    } catch(e) { addInAppAlert("error", "Search failed"); }
}

function selectMapResult(lat, lng, name) {
    document.getElementById("map-search-results").classList.add("hidden");
    document.getElementById("map-search-input").value = name.split(",")[0];
    if (mapInstance) { mapInstance.setView([lat, lng], 16); }
    if (mapMarker) { mapMarker.setLatLng([lat, lng]); }
    mapSelectedLat = lat; mapSelectedLng = lng;
    updateMapCoords(lat, lng);
}

function startMapTracking() {
    if (mapTrackWatchId !== null) { navigator.geolocation.clearWatch(mapTrackWatchId); mapTrackWatchId = null; return; }
    if (!navigator.geolocation) { addInAppAlert("error", "GPS not supported"); return; }
    document.getElementById("map-track-btn").innerHTML = '<i class="fa-solid fa-stop"></i> Stop Tracking';
    document.getElementById("map-pin-btn").classList.add("hidden");
    mapTrackWatchId = navigator.geolocation.watchPosition(function(pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (mapInstance) mapInstance.setView([lat, lng], 16);
        if (mapMarker) mapMarker.setLatLng([lat, lng]);
        mapSelectedLat = lat; mapSelectedLng = lng;
        updateMapCoords(lat, lng);
    }, function() {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

function confirmMapPin() {
    if (mapSelectedLat === null || mapSelectedLng === null) { addInAppAlert("error", "Please select a location on the map"); return; }
    if (mapCallback) {
        mapCallback(mapSelectedLat, mapSelectedLng, document.getElementById("map-search-input").value);
    }
    closeMapModal();
}

// Attach map address picker to address input
function attachMapPicker() {
    var addrInput = document.getElementById("address-input");
    if (!addrInput) return;
    // Add a map icon button next to the address input
    var parent = addrInput.parentNode;
    if (parent.querySelector(".map-pick-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-pick-btn absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 hover:text-emerald-800 text-xl";
    btn.innerHTML = '<i class="fa-solid fa-map-location-dot"></i>';
    btn.title = "Pick on map";
    btn.onclick = function() {
        openMapModal("Pick Location", null, null, function(lat, lng, name) {
            if (addrInput) addrInput.value = name || (lat.toFixed(6) + ", " + lng.toFixed(6));
        });
    };
    parent.style.position = "relative";
    parent.appendChild(btn);
}

// ============================================================
// TRACKING — Live provider tracking on active orders
// ============================================================

var trackingIntervals = {};

function startTracking(bookingId) {
    var booking = null;
    for (var i = 0; i < bookings.length; i++) {
        if (bookings[i].id === bookingId) { booking = bookings[i]; break; }
    }
    if (!booking) { addInAppAlert("error", "Booking not found"); return; }
    // Use the booking address as initial location
    openMapModal("Tracking: " + booking.serviceName, 0.3476, 32.5825, null);
    document.getElementById("map-search-box").classList.add("hidden");
    document.getElementById("map-pin-btn").classList.add("hidden");
    document.getElementById("map-track-btn").classList.remove("hidden");
    document.getElementById("map-track-btn").innerHTML = '<i class="fa-solid fa-location-dot"></i> Start Live Tracking';
    document.getElementById("map-track-btn").onclick = function() {
        if (mapTrackWatchId !== null) {
            navigator.geolocation.clearWatch(mapTrackWatchId);
            mapTrackWatchId = null;
            document.getElementById("map-track-btn").innerHTML = '<i class="fa-solid fa-location-dot"></i> Start Live Tracking';
            document.getElementById("map-pin-btn").classList.remove("hidden");
            return;
        }
        if (!navigator.geolocation) { addInAppAlert("error", "GPS not supported"); return; }
        document.getElementById("map-track-btn").innerHTML = '<i class="fa-solid fa-stop"></i> Stop Tracking';
        document.getElementById("map-pin-btn").classList.add("hidden");
        mapTrackWatchId = navigator.geolocation.watchPosition(function(pos) {
            var lat = pos.coords.latitude, lng = pos.coords.longitude;
            if (mapInstance) mapInstance.setView([lat, lng], 16);
            if (mapMarker) mapMarker.setLatLng([lat, lng]);
            mapSelectedLat = lat; mapSelectedLng = lng;
            updateMapCoords(lat, lng);
            // Broadcast position to provider if available (for provider tracking customer)
            saveTrackingPosition(bookingId, lat, lng, "customer");
        }, function() {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
    };
}

// Provider shares their live location on an active task
function startProviderTracking(taskId) {
    if (!navigator.geolocation) { addInAppAlert("error", "GPS not supported"); return; }
    if (trackingIntervals[taskId]) {
        navigator.geolocation.clearWatch(trackingIntervals[taskId]);
        delete trackingIntervals[taskId];
        addInAppAlert("info", "Location sharing stopped");
        return;
    }
    addInAppAlert("success", "Sharing your live location. Customer can now track you!");
    trackingIntervals[taskId] = navigator.geolocation.watchPosition(function(pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        saveTrackingPosition(taskId, lat, lng, "provider");
    }, function() {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

function saveTrackingPosition(orderId, lat, lng, role) {
    if (!window.__HAVENGO_JWT__) return;
    fetch(HAVENGO_BACKEND_URL + "/api/tracking/update", {
        method: "POST",
        headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderId, lat: lat, lng: lng, role: role })
    }).catch(function(e){ console.warn("Tracking update failed:", e); });
}

// ============================================================
// PROFILE RENDERING
// ============================================================
// DEPOSIT
// ============================================================

function showDepositModal() {
    if (!currentUser) { addInAppAlert("info", "Please login first to deposit funds"); showAuthModal("login"); return; }
    document.getElementById("deposit-modal").classList.remove("hidden");
}

function processDeposit() {
    if (!currentUser) { addInAppAlert("info", "Please login first to deposit funds"); showAuthModal("login"); return; }
    var amount = parseInt(document.getElementById("deposit-amount-input").value) || 0;
    var phone = document.getElementById("deposit-phone").value.trim();

    if (amount < 1000) {
        addInAppAlert("error", "Minimum deposit is 1,000 UGX");
        return;
    }
    if (!phone || phone.length < 8) {
        addInAppAlert("error", "Please enter a valid Mobile Money number");
        return;
    }

    userBalance += amount;
    closeModal("deposit-modal");
    renderProfilePage();
    addNotification("\uD83D\uDCB0", "Deposit Successful", "UGX " + amount.toLocaleString() + " added to your wallet via " + phone);
    addActivity("deposit", "Deposited UGX " + amount.toLocaleString());
    addInAppAlert("success", "Successfully deposited UGX " + amount.toLocaleString() + "!");
    saveAppState();
}

// ============================================================
// PAYMENT METHODS
// ============================================================

function addPaymentMethod() {
    if (!currentUser) { addInAppAlert("info", "Please login first to add a payment method"); showAuthModal("login"); return; }
    document.getElementById("new-payment-type").value = "MTN MoMo";
    document.getElementById("new-payment-name").value = "";
    document.getElementById("new-payment-number").value = "";
    document.getElementById("new-payment-default").checked = false;
    document.getElementById("add-payment-modal").classList.remove("hidden");
}

function submitPaymentMethod() {
    var type = document.getElementById("new-payment-type").value;
    var name = sanitizeInput(document.getElementById("new-payment-name").value.trim());
    var number = sanitizeInput(document.getElementById("new-payment-number").value.trim());
    var isDefault = document.getElementById("new-payment-default").checked;

    if (!name || !number) {
        addInAppAlert("error", "Please fill in all fields");
        return;
    }

    var method = { id: Date.now(), type: type, name: name, number: number, isDefault: isDefault };
    if (isDefault) {
        for (var i = 0; i < userPaymentMethods.length; i++) {
            userPaymentMethods[i].isDefault = false;
        }
    }
    userPaymentMethods.push(method);
    closeModal("add-payment-modal");
    renderPaymentMethods();
    addNotification("\uD83D\uDCB3", "Payment Method Added", type + " - " + name);
}

function renderPaymentMethods() {
    var list = document.getElementById("payment-methods-list");
    if (!list) return;
    if (userPaymentMethods.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-6\"><p>No payment methods saved yet.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < userPaymentMethods.length; i++) {
        var m = userPaymentMethods[i];
        var icon = m.type.indexOf("MTN") !== -1 || m.type.indexOf("Airtel") !== -1 ? "\uD83D\uDCF1" : m.type === "Visa" ? "\uD83D\uDCB3" : "\uD83C\uDFE6";
        var stars = "";
        for (var j = 0; j < m.number.length - 4; j++) stars += "*";
        var defaultBadge = m.isDefault ? "<span class=\"text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full\">Default</span>" : "";
        html += "<div class=\"flex items-center justify-between bg-gray-50 p-4 rounded-2xl\">" +
            "<div class=\"flex items-center gap-3\">" +
            "<div class=\"w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-lg\">" + icon + "</div>" +
            "<div><p class=\"font-medium\">" + m.name + "</p>" +
            "<p class=\"text-xs text-gray-500\">" + m.type + " \u2022 " + stars + m.number.slice(-4) + "</p></div></div>" +
            "<div class=\"flex items-center gap-2\">" + defaultBadge +
            "<button onclick=\"removePaymentMethod(" + m.id + ")\" class=\"text-red-500 text-sm\"><i class=\"fa-solid fa-trash-can\"></i></button></div></div>";
    }
    list.innerHTML = html;
}

function removePaymentMethod(id) {
    var filtered = [];
    for (var i = 0; i < userPaymentMethods.length; i++) {
        if (userPaymentMethods[i].id !== id) filtered.push(userPaymentMethods[i]);
    }
    userPaymentMethods = filtered;
    renderPaymentMethods();
}

// ============================================================
// PENDING PAYMENTS (Payment on Completion)
// ============================================================

function showPaymentsPending() {
    var pending = [];
    for (var i = 0; i < pendingPayments.length; i++) {
        if (!pendingPayments[i].paid) pending.push(pendingPayments[i]);
    }
    if (pending.length === 0) {
        addInAppAlert("info", "No pending payments at this time.");
        return;
    }
    var details = document.getElementById("pending-payment-details");
    var latest = pending[0];
    var deadlineHtml = "";
    if (latest.deadline) {
        var remaining = latest.deadline - Date.now();
        if (remaining > 0) {
            var hours = Math.floor(remaining / 3600000);
            var mins = Math.floor((remaining % 3600000) / 60000);
            deadlineHtml = "<p class=\"text-xs text-amber-600 mt-1\"><i class=\"fa-solid fa-clock\"></i> Auto-deduct in: <span id=\"payment-countdown-display\">" + hours + "h " + mins + "m</span></p>";
        } else {
            deadlineHtml = "<p class=\"text-xs text-red-600 mt-1\"><i class=\"fa-solid fa-exclamation-triangle\"></i> Deadline passed — auto-deduct pending</p>";
        }
    }
    details.innerHTML = "<p class=\"font-medium\">" + (latest.taskName || "Task") + "</p>" +
        "<p class=\"text-2xl font-bold text-emerald-600 mt-2\">UGX " + (latest.amount || 0).toLocaleString() + "</p>" +
        "<p class=\"text-sm text-gray-500 mt-1\">Provider: " + (latest.providerName || "Unknown") + "</p>" +
        deadlineHtml +
        "<p class=\"text-xs text-gray-400\">" + (latest.date || "") + "</p>";
    document.getElementById("payment-confirm-modal").classList.remove("hidden");
    // Start countdown timer
    if (latest.deadline && latest.deadline > Date.now()) {
        if (window.__paymentCountdownTimer) clearInterval(window.__paymentCountdownTimer);
        window.__paymentCountdownTimer = setInterval(function() {
            var rem = latest.deadline - Date.now();
            if (rem <= 0) {
                clearInterval(window.__paymentCountdownTimer);
                var cd = document.getElementById("payment-countdown-display");
                if (cd) cd.textContent = "0h 0m";
                checkAutoPayments();
                return;
            }
            var h = Math.floor(rem / 3600000);
            var m = Math.floor((rem % 3600000) / 60000);
            var cd = document.getElementById("payment-countdown-display");
            if (cd) cd.textContent = h + "h " + m + "m";
        }, 10000);
    }
}

async function confirmPayment() {
    var pending = [];
    for (var i = 0; i < pendingPayments.length; i++) {
        if (!pendingPayments[i].paid) pending.push(pendingPayments[i]);
    }
    if (pending.length === 0) return;
    var payment = pending[0];

    if (!currentUser) { addInAppAlert("info", "Please login first to confirm payment"); showAuthModal("login"); return; }
    if (userBalance < payment.amount) {
        addInAppAlert("error", "Insufficient balance. Please deposit funds first.");
        closeModal("payment-confirm-modal");
        return;
    }

    // Try backend first to deduct and confirm payment
    if (window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(HAVENGO_BACKEND_URL + "/api/customer/confirm-payment", {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                body: JSON.stringify({ taskId: payment.taskId })
            });
            var data = await resp.json();
            if (data.session_expired) { handleSessionExpired(); closeModal("payment-confirm-modal"); return; }
            if (!data.success) {
                addInAppAlert("error", data.error || "Failed to confirm payment on server");
                closeModal("payment-confirm-modal");
                return;
            }
        } catch(e) {
            // Fall through to local deduction
        }
    }

    userBalance -= payment.amount;
    payment.paid = true;

    // 85/15 split: provider gets 85%, system gets 15%
    var providerShare = Math.round(payment.amount * 0.85);
    var systemShare = payment.amount - providerShare;
    if (payment.providerName) {
        if (!providerEarningsMap[payment.providerName]) providerEarningsMap[payment.providerName] = 0;
        providerEarningsMap[payment.providerName] += providerShare;
    }
    earnings += providerShare;

    // Show system fee in contact section
    closeModal("payment-confirm-modal");
    renderProfilePage();

    addNotification("\u2705", "Payment Confirmed", "UGX " + payment.amount.toLocaleString() + " paid to " + payment.providerName + " for " + payment.taskName);
    addActivity("payment", "Paid UGX " + payment.amount.toLocaleString() + " to " + payment.providerName);

    // Ask for provider rating
    showAppConfirm("Payment completed! Would you like to rate " + payment.providerName + "?", function(rateProvider) {
        if (rateProvider) {
            showAppPrompt("Rate " + payment.providerName + " (1-5 stars):", "5", function(rating) {
                if (rating) {
                    var numRating = parseInt(rating);
                    if (numRating >= 1 && numRating <= 5) {
                        userRatings.push({ providerName: payment.providerName, rating: numRating, taskName: payment.taskName });
                        updateProviderUI();
                        addNotification("\u2B50", "Provider Rated", "You rated " + payment.providerName + " " + numRating + " stars!");
                    }
                }
            });
        }
    });
    addInAppAlert("success", "Payment of UGX " + payment.amount.toLocaleString() + " confirmed successfully!");
}

// ============================================================
// PROFILE RENDERING
// ============================================================

function renderProfilePage() {
    var orderCount = document.getElementById("profile-order-count");
    var balanceDisplay = document.getElementById("profile-balance-display");
    var accountBalance = document.getElementById("profile-account-balance");
    var providersCount = document.getElementById("profile-favorite-providers-count");

    if (orderCount) orderCount.textContent = bookings.length;
    if (balanceDisplay) balanceDisplay.textContent = userBalance.toLocaleString() + " UGX";
    if (accountBalance) accountBalance.textContent = userBalance.toLocaleString() + " UGX";
    if (providersCount) providersCount.textContent = favoriteProviders.length;

    renderRecentActivity();
    renderPaymentMethods();
    renderSavedAddresses();
    renderProfileNotifications();

    var delContainer = document.getElementById("delete-account-container");
    if (delContainer) {
        delContainer.style.display = currentUser ? "block" : "none";
    }

    // Restore bitmoji/photo on refresh
    if (profilePicSrc) {
        var pic = document.getElementById("profile-pic");
        var bitmojiDisplay = document.getElementById("profile-bitmoji-display");
        if (profilePicSrc.startsWith("http") || profilePicSrc.startsWith("data:")) {
            pic.src = profilePicSrc;
            pic.classList.remove("hidden");
            bitmojiDisplay.classList.add("hidden");
        } else {
            bitmojiDisplay.textContent = profilePicSrc;
            bitmojiDisplay.classList.remove("hidden");
            pic.classList.add("hidden");
        }
    }
}

function addActivity(type, description) {
    userActivity.unshift({
        type: type || "info",
        description: description || "",
        time: Date.now()
    });
    // Keep activity for 30 days
    var now = Date.now();
    var thirtyDays = 30 * 24 * 60 * 60 * 1000;
    var filtered = [];
    for (var i = 0; i < userActivity.length; i++) {
        var age = now - userActivity[i].time;
        if (age < thirtyDays) filtered.push(userActivity[i]);
    }
    if (filtered.length === 0) filtered = [];
    userActivity = filtered;
    saveAppState();
}

function renderRecentActivity() {
    var list = document.getElementById("recent-activity-list");
    if (!list) return;
    // Clean up expired entries
    addActivity("_cleanup", "");
    if (userActivity.length === 0) {
        list.innerHTML = "<p class=\"text-gray-400 text-center py-4\">No recent activity</p>";
        return;
    }
    var icons = { signup: "\uD83D\uDE80", deposit: "\uD83D\uDCB0", payment: "\u2705", booking: "\uD83D\uDCCB", logout: "\uD83D\uDD13", login: "\uD83D\uDD13", task: "\uD83D\uDCCC", review: "\u2B50" };
    var html = "";
    var maxItems = Math.min(10, userActivity.length);
    for (var i = 0; i < maxItems; i++) {
        var a = userActivity[i];
        if (a.type === "_cleanup") continue;
        var icon = icons[a.type] || "\uD83D\uDCCC";
        var timeStr = typeof a.time === "number" ? new Date(a.time).toLocaleString() : a.time;
        html += "<div class=\"flex items-start gap-3\">" +
            "<span class=\"text-lg\">" + icon + "</span>" +
            "<div class=\"flex-1\">" +
            "<p class=\"text-gray-700\">" + a.description + "</p>" +
            "<p class=\"text-xs text-gray-400\">" + timeStr + "</p></div></div>";
    }
    list.innerHTML = html;
}

function switchProfileTab(n) {
    var tabs = document.querySelectorAll(".profile-tab");
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("border-emerald-600", i === n);
        tabs[i].classList.toggle("font-medium", i === n);
        tabs[i].classList.toggle("text-gray-500", i !== n);
    }
    var contents = document.querySelectorAll(".profile-tab-content");
    for (var i = 0; i < contents.length; i++) {
        contents[i].classList.toggle("hidden", i !== n);
    }
    if (n === 1) renderPaymentMethods();
    if (n === 2) renderSavedAddresses();
    if (n === 3) renderProfileNotifications();
    if (n === 4) renderFavoriteProviders();
    if (n === 5) { if (currentUser) openCustomerAdminChat(); }
}

function updateProfilePicCursor() {
    var pic = document.getElementById("profile-pic");
    if (pic) pic.classList.toggle("cursor-pointer", !!currentUser);
    var bitmoji = document.getElementById("profile-bitmoji-display");
    if (bitmoji) bitmoji.classList.toggle("cursor-pointer", !!currentUser);
}

function triggerProfilePicUpload() {
    if (!currentUser) { addInAppAlert("info", "Please login first to update your profile picture"); showAuthModal("login"); return; }
    document.getElementById("profile-pic-upload").click();
}

function handleProfilePicUpload(event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        profilePicSrc = e.target.result;
        document.getElementById("profile-pic").src = profilePicSrc;
        document.getElementById("profile-pic").classList.remove("hidden");
        document.getElementById("profile-bitmoji-display").classList.add("hidden");
        var btn = document.getElementById("toggle-avatar-btn");
        if (btn) btn.innerHTML = '<i class="fa-solid fa-face-smile"></i> Bitmoji';
        addActivity("info", "Updated profile picture");
    };
    reader.readAsDataURL(file);
}

var customerBitmoji = null;

function showCustomerBitmojiPicker() {
    if (!currentUser) { addInAppAlert("info", "Please login first to choose a bitmoji"); showAuthModal("login"); return; }
    var grid = document.getElementById("customer-bitmoji-grid");
    if (!grid) return;
    var html = "";
    for (var i = 0; i < bitmojiOptions.length; i++) {
        var b = bitmojiOptions[i];
        var activeClass = customerBitmoji === b ? "bg-emerald-100 border-emerald-600" : "";
        html += "<div onclick=\"selectCustomerBitmoji('" + b + "')\" class=\"p-1 border rounded-xl cursor-pointer text-center hover:bg-emerald-50 hover:border-emerald-600 " + activeClass + "\">" + b + "</div>";
    }
    grid.innerHTML = html;
    document.getElementById("profile-bitmoji-picker").classList.remove("hidden");
}

function selectCustomerBitmoji(emoji) {
    customerBitmoji = emoji;
    profilePicSrc = emoji;
    document.getElementById("profile-pic").classList.add("hidden");
    var bitmojiDisplay = document.getElementById("profile-bitmoji-display");
    bitmojiDisplay.classList.remove("hidden");
    bitmojiDisplay.textContent = emoji;
    document.getElementById("profile-bitmoji-picker").classList.add("hidden");
    document.getElementById("toggle-avatar-btn").innerHTML = '<i class="fa-solid fa-image"></i> Photo';
    addActivity("info", "Updated profile bitmoji");
}

function toggleCustomerAvatar() {
    var pic = document.getElementById("profile-pic");
    var bitmoji = document.getElementById("profile-bitmoji-display");
    var btn = document.getElementById("toggle-avatar-btn");
    if (bitmoji && !bitmoji.classList.contains("hidden")) {
        bitmoji.classList.add("hidden");
        pic.classList.remove("hidden");
        pic.src = "https://images.unsplash.com/photo-1531123897720-8f129e1688f7?w=400";
        if (btn) btn.innerHTML = '<i class="fa-solid fa-face-smile"></i> Bitmoji';
    } else {
        showCustomerBitmojiPicker();
    }
}

// ============================================================
// SAVED ADDRESSES
// ============================================================

function renderFavoriteProviders() {
    var list = document.getElementById("favorite-providers-list");
    if (!list) return;
    if (favoriteProviders.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-6\"><i class=\"fa-regular fa-heart text-4xl mb-3\"></i><p>No favorite providers yet.</p><p class=\"text-xs\">Tap the heart icon on any provider to save them here.</p></div>";
        return;
    }
    var html = "";
    for (var fi = 0; fi < favoriteProviders.length; fi++) {
        var fp = favoriteProviders[fi];
        html += "<div class=\"flex items-center justify-between bg-gray-50 rounded-2xl p-4\">" +
            "<div class=\"flex items-center gap-3\">" +
            "<div class=\"w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl\">🔧</div>" +
            "<div><p class=\"font-medium\">" + fp.name + "</p><p class=\"text-xs text-gray-500\">" + (fp.email || "") + "</p></div></div>" +
            "<button onclick=\"toggleFavoriteProvider('" + (fp.email || '').replace(/'/g,"\\'") + "','" + fp.name.replace(/'/g,"\\'") + "')\" class=\"text-red-500 text-sm\"><i class=\"fa-solid fa-heart-broken\"></i> Remove</button></div>";
    }
    list.innerHTML = html;
}

function renderSavedAddresses() {
    var list = document.getElementById("saved-addresses-list");
    if (!list) return;
    if (savedAddresses.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-6\"><i class=\"fa-solid fa-location-dot text-3xl mb-3\"></i><p>No saved addresses yet.</p><p class=\"text-xs\">Add an address to quickly fill in bookings.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < savedAddresses.length; i++) {
        var a = savedAddresses[i];
        html += "<div class=\"flex items-center justify-between bg-gray-50 p-4 rounded-2xl\">" +
            "<div class=\"flex items-center gap-3\">" +
            "<div class=\"w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-lg\">\uD83D\uDCCD</div>" +
            "<div><p class=\"font-medium\">" + a.label + "</p>" +
            "<p class=\"text-sm text-gray-500\">" + a.address + "</p></div></div>" +
            "<button onclick=\"removeAddress(" + a.id + ")\" class=\"text-red-500 text-sm\"><i class=\"fa-solid fa-trash-can\"></i></button></div>";
    }
    list.innerHTML = html;
}

function addNewAddress() {
    if (!currentUser) { addInAppAlert("info", "Please login first to save an address"); showAuthModal("login"); return; }
    showAppPrompt("Enter a label for this address (e.g. Home, Office):", "", function(label) {
        if (!label) return;
        showAppPrompt("Enter the full address:", "", function(address) {
            if (!address) return;
            var cleanLabel = sanitizeInput(label);
            var cleanAddress = sanitizeInput(address);
            savedAddresses.push({ id: Date.now(), label: cleanLabel, address: cleanAddress });
            renderSavedAddresses();
            addActivity("info", "Added new address: " + cleanLabel);
            saveAppState();
        });
    });
}

function removeAddress(id) {
    var filtered = [];
    for (var i = 0; i < savedAddresses.length; i++) {
        if (savedAddresses[i].id !== id) filtered.push(savedAddresses[i]);
    }
    savedAddresses = filtered;
    renderSavedAddresses();
}

// ============================================================
// ORIGINAL APP FUNCTIONS
// ============================================================

function navigateToProfileTab(n) {
    navigateTo("profile");
    switchProfileTab(n);
}

// ============================================================
// SERVICES PAGE — SEARCH, FILTER & SORT
// ============================================================

function filterServicesPage() {
    var q = (document.getElementById("services-search").value || "").trim().toLowerCase();
    var cat = document.getElementById("services-category-filter").value;
    var sort = document.getElementById("services-sort").value;
    var grid = document.querySelector("#services .grid");
    var cards = grid ? Array.from(grid.querySelectorAll(".provider-card")) : [];
    var noResults = document.getElementById("services-no-results");
    var visibleCount = 0;

    for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var sid = card.getAttribute("data-sid");
        var serviceNames = [];
        for (var si = 0; si < services.length; si++) {
            if (services[si].id === sid) serviceNames.push(services[si].name.toLowerCase());
        }

        var provInfo = [];
        for (var pi = 0; pi < registeredProviders.length; pi++) {
            var rp = registeredProviders[pi];
            var matchesService = false;
            if (rp.services && rp.services.length > 0) {
                for (var sj = 0; sj < rp.services.length; sj++) {
                    if (rp.services[sj].id === sid || rp.services[sj].name === sid) { matchesService = true; break; }
                }
            }
            if (matchesService) {
                if (rp.business_name) provInfo.push(rp.business_name.toLowerCase());
                if (rp.name) provInfo.push(rp.name.toLowerCase());
                if (rp.location) provInfo.push(rp.location.toLowerCase());
            }
        }

        var matchCat = !cat || sid === cat;
        var matchSearch = true;
        if (q) {
            matchSearch = false;
            for (var ni = 0; ni < serviceNames.length; ni++) {
                if (serviceNames[ni].indexOf(q) !== -1) { matchSearch = true; break; }
            }
            if (!matchSearch) {
                for (var pi2 = 0; pi2 < provInfo.length; pi2++) {
                    if (provInfo[pi2].indexOf(q) !== -1) { matchSearch = true; break; }
                }
            }
            // Also search card title and description
            if (!matchSearch) {
                var cardTitle = card.querySelector("h3");
                if (cardTitle && cardTitle.textContent.toLowerCase().indexOf(q) !== -1) matchSearch = true;
            }
            if (!matchSearch) {
                var cardDesc = card.querySelector("p.text-gray-600");
                if (cardDesc && cardDesc.textContent.toLowerCase().indexOf(q) !== -1) matchSearch = true;
            }
        }

        if (matchCat && matchSearch) {
            card.style.display = "";
            visibleCount++;
        } else {
            card.style.display = "none";
        }
    }

    if (sort && grid) {
        // Compute ratings and job counts for sorting
        var ratingMap = {};
        for (var ri = 0; ri < userRatings.length; ri++) {
            var ur = userRatings[ri];
            var taskId = ur.taskName || "";
            for (var si = 0; si < services.length; si++) {
                if (taskId.indexOf(services[si].name) !== -1) {
                    if (!ratingMap[services[si].id]) ratingMap[services[si].id] = [];
                    ratingMap[services[si].id].push(ur.rating);
                    break;
                }
            }
        }
        for (var vi = 0; vi < reviews.length; vi++) {
            var rv = reviews[vi];
            if (rv.serviceName) {
                for (var si = 0; si < services.length; si++) {
                    if (rv.serviceName.indexOf(services[si].name) !== -1) {
                        if (!ratingMap[services[si].id]) ratingMap[services[si].id] = [];
                        ratingMap[services[si].id].push(rv.rating);
                        break;
                    }
                }
            }
        }

        var jobCountMap = {};
        for (var ci = 0; ci < completedTasks.length; ci++) {
            var ct = completedTasks[ci];
            if (ct.serviceName) {
                for (var si = 0; si < services.length; si++) {
                    if (ct.serviceName.indexOf(services[si].name) !== -1) {
                        if (!jobCountMap[services[si].id]) jobCountMap[services[si].id] = 0;
                        jobCountMap[services[si].id]++;
                        break;
                    }
                }
            }
        }

        var sorted = cards.filter(function(c) { return c.style.display !== "none"; });
        sorted.sort(function(a, b) {
            var pa = parseInt(a.getAttribute("data-price")) || 0;
            var pb = parseInt(b.getAttribute("data-price")) || 0;
            var sidA = a.getAttribute("data-sid");
            var sidB = b.getAttribute("data-sid");

            if (sort === "price-asc") return pa - pb;
            if (sort === "price-desc") return pb - pa;

            if (sort === "rating-desc") {
                var rateA = ratingMap[sidA];
                var rateB = ratingMap[sidB];
                var avgA = rateA && rateA.length > 0 ? rateA.reduce(function(x,y){return x+y;},0)/rateA.length : 0;
                var avgB = rateB && rateB.length > 0 ? rateB.reduce(function(x,y){return x+y;},0)/rateB.length : 0;
                return avgB - avgA;
            }

            if (sort === "name-asc") {
                var titleA = a.querySelector("h3");
                var titleB = b.querySelector("h3");
                var tA = titleA ? titleA.textContent.trim().toLowerCase() : "";
                var tB = titleB ? titleB.textContent.trim().toLowerCase() : "";
                if (tA < tB) return -1;
                if (tA > tB) return 1;
                return 0;
            }

            if (sort === "jobs-desc") {
                var jA = jobCountMap[sidA] || 0;
                var jB = jobCountMap[sidB] || 0;
                return jB - jA;
            }

            return 0;
        });
        for (var si2 = 0; si2 < sorted.length; si2++) {
            grid.appendChild(sorted[si2]);
        }
        for (var hi = 0; hi < cards.length; hi++) {
            if (cards[hi].style.display === "none") grid.appendChild(cards[hi]);
        }
    }

    if (noResults) noResults.classList.toggle("hidden", visibleCount > 0);
}

function clearServicesFilters() {
    document.getElementById("services-search").value = "";
    document.getElementById("services-category-filter").value = "";
    document.getElementById("services-sort").value = "";
    filterServicesPage();
}

// Populate category filter dynamically from services array
function populateServiceFilters() {
    var select = document.getElementById("services-category-filter");
    if (!select) return;
    // Keep only the "All Categories" option
    while (select.options.length > 1) select.remove(1);
    for (var i = 0; i < services.length; i++) {
        var opt = document.createElement("option");
        opt.value = services[i].id;
        opt.textContent = services[i].name;
        select.appendChild(opt);
    }
}

function searchServices() {
    var input = document.getElementById("searchInput");
    var q = input ? input.value.trim().toLowerCase() : "";
    var results = document.getElementById("search-results");
    if (!results) return;
    if (!q) { results.classList.add("hidden"); results.innerHTML = ""; return; }

    // Search service names
    var serviceMatches = [];
    for (var i = 0; i < services.length; i++) {
        if (services[i].name.toLowerCase().indexOf(q) !== -1) serviceMatches.push(services[i]);
    }

    // Search provider names, business names, and locations
    var providerMatches = [];
    for (var pi = 0; pi < registeredProviders.length; pi++) {
        var rp = registeredProviders[pi];
        var displayName = rp.business_name || rp.businessName || rp.name || "";
        var location = rp.location || "";
        if (displayName.toLowerCase().indexOf(q) !== -1 || location.toLowerCase().indexOf(q) !== -1) {
            providerMatches.push(rp);
        }
    }

    if (serviceMatches.length === 0 && providerMatches.length === 0) {
        results.innerHTML = "<p class=\"text-gray-500 p-3\">No services or providers found</p>" +
            "<div onclick=\"document.getElementById('services-search').value='" + q.replace(/'/g,"\\'") + "';navigateTo('services');filterServicesPage()\" class=\"px-3 pb-3\"><button class=\"w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl text-sm font-medium\">Search on Services Page <i class=\"fa-solid fa-arrow-right ml-1\"></i></button></div>";
        results.classList.remove("hidden");
        return;
    }

    var html = "";
    // Service matches
    for (var i = 0; i < serviceMatches.length && i < 5; i++) {
        var s = serviceMatches[i];
        html += "<div onclick=\"navigateTo('services');filterServicesPage()\" class=\"flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl cursor-pointer\">" +
            "<span class=\"text-2xl\">\uD83D\uDCCB</span>" +
            "<div><p class=\"font-medium\">" + s.name + "</p>" +
            "<p class=\"text-sm text-emerald-600\">UGX " + s.basePrice.toLocaleString() + "</p></div></div>";
    }
    // Provider matches
    for (var pi = 0; pi < providerMatches.length && pi < 4; pi++) {
        var rp = providerMatches[pi];
        var displayName = rp.business_name || rp.businessName || rp.name || "";
        var location = rp.location || "";
        html += "<div onclick=\"navigateTo('services')\" class=\"flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl cursor-pointer border-t border-gray-100\">" +
            "<div class=\"bitmoji\">" + (rp.bitmoji || "\uD83D\uDC64") + "</div>" +
            "<div><p class=\"font-medium\">" + displayName + "</p>" +
            "<p class=\"text-xs text-gray-500\">" + (location ? location + " \u2022 " : "") + "Service Provider</p></div></div>";
    }
    if (serviceMatches.length + providerMatches.length > 0) {
        html += "<div onclick=\"document.getElementById('services-search').value='" + q.replace(/'/g,"\\'") + "';navigateTo('services');filterServicesPage()\" class=\"px-3 pb-2 pt-1 border-t border-gray-100\">" +
            "<button class=\"w-full text-sm text-emerald-600 font-medium hover:text-emerald-700\">See all results <i class=\"fa-solid fa-arrow-right ml-1\"></i></button></div>";
    }
    results.innerHTML = html;
    results.classList.remove("hidden");
}

function toggleProviders(id) {
    var el = document.getElementById(id);
    var chevron = document.getElementById("chevron-" + id);
    if (!el) return;
    el.classList.toggle("hidden");
    if (chevron) chevron.classList.toggle("fa-chevron-down");
    if (chevron) chevron.classList.toggle("fa-chevron-up");
}

function scrollReviews(dir) {
    var carousel = document.getElementById("reviews-carousel");
    if (carousel) carousel.scrollBy({ left: dir * 360, behavior: "smooth" });
}

function scrollTestimonials(dir) {
    var grid = document.getElementById("reviews-grid");
    if (!grid) return;
    var scrollAmt = grid.querySelector(".md\\:grid-cols-3") ? 400 : 360;
    grid.scrollBy({ left: dir * scrollAmt, behavior: "smooth" });
}



function selectService(serviceId, providerName) {
    var service = null;
    for (var i = 0; i < services.length; i++) {
        if (services[i].id === serviceId) { service = services[i]; break; }
    }
    if (!service) return;
    currentService = service;
    currentSelectedProvider = providerName || null;
    var results = document.getElementById("search-results");
    if (results) results.classList.add("hidden");
    showCheckout();
}

function showCheckout() {
    if (!currentService) return;
    document.getElementById("modal-service").innerHTML = "<div class=\"flex items-center gap-3\">" +
        "<span class=\"text-3xl\">" + (serviceEmojis[currentService.category] || "\uD83D\uDCCB") + "</span>" +
        "<div><p class=\"font-semibold\">" + currentService.name + "</p>" +
        "<p class=\"text-sm text-gray-500\">Base price: UGX " + currentService.basePrice.toLocaleString() + "</p></div></div>";
    updatePriceDisplay();
    renderDynamicFields();

    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById("booking-date").value = tomorrow.toISOString().split("T")[0];
    document.getElementById("booking-time").value = "09:00";

    document.getElementById("checkout-modal").classList.remove("hidden");
    setTimeout(attachMapPicker, 100);
}

function updatePriceDisplay() {
    if (!currentService) return;
    var price = calculateDynamicPrice(currentService.id);
    document.getElementById("modal-price").innerHTML = "UGX " + price.toLocaleString() + " <span class=\"text-xs font-normal text-gray-500\">(dynamic)</span>";
    document.getElementById("modal-service-type").textContent = currentService.category.charAt(0).toUpperCase() + currentService.category.slice(1) + " Service";
}

function renderDynamicFields() {
    var container = document.getElementById("dynamic-fields");
    if (!container || !currentService) return;
    var html = "";
    var c = currentService.category;
    if (c === "cleaning") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Number of Rooms</label><input type=\"number\" id=\"clean-rooms\" value=\"2\" min=\"1\" max=\"20\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div><div><label class=\"font-medium block mb-2\">Bathrooms</label><input type=\"number\" id=\"clean-bathrooms\" value=\"1\" min=\"1\" max=\"10\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div></div><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer mt-3\"><input type=\"checkbox\" id=\"clean-compound\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>Include Compound / Yard Cleaning <span class=\"text-emerald-600 font-medium\">(+60%)</span></span></label>";
    } else if (c === "spa") {
        html = "<div class=\"space-y-3\"><label class=\"font-medium block mb-2\">Select Services (multiple)</label><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer\"><input type=\"checkbox\" id=\"spa-massage\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>Full Body Massage <span class=\"text-emerald-600\">+40,000</span></span></label><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer\"><input type=\"checkbox\" id=\"spa-nails\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>Manicure & Pedicure <span class=\"text-emerald-600\">+35,000</span></span></label><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer\"><input type=\"checkbox\" id=\"spa-facial\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>Deep Facial <span class=\"text-emerald-600\">+40,000</span></span></label></div>";
    } else if (c === "hair") {
        html = "<div><label class=\"font-medium block mb-2\">Hair Style</label><select id=\"hair-style\" onchange=\"updatePriceDisplay()\" class=\"w-full border rounded-2xl px-4 py-4\"><option value=\"knotless\">Knotless Braids <span class=\"text-emerald-600\">(120,000)</span></option><option value=\"weave\">Weaves (90,000)</option><option value=\"dread\">Dreadlocks (110,000)</option><option value=\"perm\">Perm & Style (75,000)</option><option value=\"cut\">Haircut & Barber (35,000)</option></select></div>";
    } else if (c === "catering") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Number of Guests</label><input type=\"number\" id=\"catering-guests\" value=\"20\" min=\"5\" max=\"1000\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div><div><label class=\"font-medium block mb-2\">Service Style</label><select id=\"catering-style\" onchange=\"updatePriceDisplay()\" class=\"w-full border rounded-2xl px-4 py-4\"><option value=\"buffet\">Buffet</option><option value=\"sitdown\">Sit-down</option></select></div></div><div class=\"mt-3 text-sm text-gray-500\">Base price: 120,000 UGX for 20 guests. Additional guests charged proportionally.</div>";
    } else if (c === "kids") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Number of Children</label><input type=\"number\" id=\"kids-count\" value=\"1\" min=\"1\" max=\"20\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div><div><label class=\"font-medium block mb-2\">Hours Needed</label><input type=\"number\" id=\"kids-hours\" value=\"3\" min=\"1\" max=\"12\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div></div><div class=\"mt-3 text-sm text-gray-500\">Base price: 60,000 UGX for 1 child, 3 hours. Each additional child or hour adds proportionally.</div>";
    } else if (c === "nursing") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Care Type</label><select id=\"nursing-type\" onchange=\"updatePriceDisplay()\" class=\"w-full border rounded-2xl px-4 py-4\"><option value=\"elderly\">Elderly Care</option><option value=\"postsurgery\">Post-Surgery Recovery</option><option value=\"general\">General Nursing</option></select></div><div><label class=\"font-medium block mb-2\">Days Needed</label><input type=\"number\" id=\"nursing-days\" value=\"1\" min=\"1\" max=\"30\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div></div><div class=\"mt-3 text-sm text-gray-500\">Base price: 80,000 UGX per day for home nursing care.</div>";
    } else if (c === "family") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Number of People</label><input type=\"number\" id=\"family-count\" value=\"1\" min=\"1\" max=\"10\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div><div><label class=\"font-medium block mb-2\">Hours Needed</label><input type=\"number\" id=\"family-hours\" value=\"4\" min=\"1\" max=\"24\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div></div>";
    } else if (c === "errands") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Number of Items</label><input type=\"number\" id=\"errand-items\" value=\"1\" min=\"1\" max=\"50\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div><div><label class=\"font-medium block mb-2\">Distance (km)</label><input type=\"number\" id=\"errand-distance\" value=\"5\" min=\"1\" max=\"50\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div></div>";
    } else if (c === "appliance") {
        html = "<div><label class=\"font-medium block mb-2\">Appliance Type</label><select id=\"appliance-type\" onchange=\"updatePriceDisplay()\" class=\"w-full border rounded-2xl px-4 py-4\"><option value=\"ac\">AC Unit (120,000)</option><option value=\"fridge\">Refrigerator (85,000)</option><option value=\"washer\">Washing Machine (75,000)</option><option value=\"oven\">Oven / Cooker (65,000)</option><option value=\"other\">Other Appliance (55,000)</option></select></div>";
    } else if (c === "gardening") {
        html = "<div class=\"grid grid-cols-2 gap-4\"><div><label class=\"font-medium block mb-2\">Garden Size (sq.m)</label><input type=\"number\" id=\"garden-size\" value=\"50\" min=\"10\" max=\"1000\" class=\"w-full border rounded-2xl px-4 py-4\" onchange=\"updatePriceDisplay()\"></div><div><label class=\"font-medium block mb-2\">Service Type</label><select id=\"garden-service\" onchange=\"updatePriceDisplay()\" class=\"w-full border rounded-2xl px-4 py-4\"><option value=\"basic\">Basic Lawn Care</option><option value=\"full\">Full Landscaping</option></select></div></div>";
    } else if (c === "event") {
        html = "<div class=\"space-y-3\"><label class=\"font-medium block mb-2\">Select Items</label><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer\"><input type=\"checkbox\" id=\"event-tent\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>Large Tent <span class=\"text-emerald-600\">+120,000</span></span></label><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer\"><input type=\"checkbox\" id=\"event-chairs\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>50 Executive Chairs <span class=\"text-emerald-600\">+45,000</span></span></label><label class=\"flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer\"><input type=\"checkbox\" id=\"event-sound\" onchange=\"updatePriceDisplay()\" class=\"w-5 h-5\"><span>Sound System <span class=\"text-emerald-600\">+85,000</span></span></label></div>";
    } else if (c === "auto") {
        html = "<div><label class=\"font-medium block mb-2\">Service Type</label><select id=\"auto-service\" onchange=\"updatePriceDisplay()\" class=\"w-full border rounded-2xl px-4 py-4\"><option value=\"basic\">Basic Wash (45,000)</option><option value=\"full\">Full Detail (95,000)</option><option value=\"interior\">Interior Only (55,000)</option></select></div>";
    }
    container.innerHTML = html;
    // Re-attach change listeners for price updates on all inputs
    var inputs = container.querySelectorAll("input, select");
    for (var idx = 0; idx < inputs.length; idx++) {
        inputs[idx].addEventListener("change", updatePriceDisplay);
        inputs[idx].addEventListener("input", updatePriceDisplay);
    }
}

function calculateDynamicPrice(serviceId) {
    var service = null;
    for (var i = 0; i < services.length; i++) {
        if (services[i].id === serviceId) { service = services[i]; break; }
    }
    if (!service) return 0;
    var base = service.basePrice;
    var cat = service.category;
    var total = base;

    if (cat === "cleaning") {
        var rooms = parseInt(document.getElementById("clean-rooms") ? document.getElementById("clean-rooms").value : 2) || 2;
        var bathrooms = parseInt(document.getElementById("clean-bathrooms") ? document.getElementById("clean-bathrooms").value : 1) || 1;
        var compound = document.getElementById("clean-compound") ? document.getElementById("clean-compound").checked : false;
        // Each room adds 60% of base, each bathroom adds 30% of base
        total = base + (base * 0.6 * (rooms - 1)) + (base * 0.3 * (bathrooms - 1));
        if (compound) total += base * 0.6;
    } else if (cat === "catering") {
        var guests = parseInt(document.getElementById("catering-guests") ? document.getElementById("catering-guests").value : 20) || 20;
        // Base is for 20 guests. Each additional 100 guests = 60% increase
        var additionalGuests = Math.max(0, guests - 20);
        var increaseFactor = (additionalGuests / 100) * 0.6;
        total = base * (1 + increaseFactor);
    } else if (cat === "kids") {
        var kidsCount = parseInt(document.getElementById("kids-count") ? document.getElementById("kids-count").value : 1) || 1;
        var hours = parseInt(document.getElementById("kids-hours") ? document.getElementById("kids-hours").value : 3) || 3;
        var extraKids = Math.max(0, kidsCount - 1);
        var extraHours = Math.max(0, hours - 3);
        total = base + (base * 0.6 * extraKids) + (base * 0.2 * extraHours);
    } else if (cat === "nursing") {
        var nursingType = document.getElementById("nursing-type") ? document.getElementById("nursing-type").value : "elderly";
        var nursingDays = parseInt(document.getElementById("nursing-days") ? document.getElementById("nursing-days").value : 1) || 1;
        var nursingMultiplier = { elderly: 1.0, postsurgery: 1.2, general: 0.9 };
        total = base * nursingDays * (nursingMultiplier[nursingType] || 1.0);
    } else if (cat === "spa") {
        var massage = document.getElementById("spa-massage") ? document.getElementById("spa-massage").checked : false;
        var nails = document.getElementById("spa-nails") ? document.getElementById("spa-nails").checked : false;
        var facial = document.getElementById("spa-facial") ? document.getElementById("spa-facial").checked : false;
        total = 0;
        if (massage) total += 40000;
        if (nails) total += 35000;
        if (facial) total += 40000;
        if (total === 0) total = base;
    } else if (cat === "hair") {
        var style = document.getElementById("hair-style") ? document.getElementById("hair-style").value : "knotless";
        var prices = { knotless: 120000, weave: 90000, dread: 110000, perm: 75000, cut: 35000 };
        total = prices[style] || base;
    } else if (cat === "family") {
        var count = parseInt(document.getElementById("family-count") ? document.getElementById("family-count").value : 1) || 1;
        var fhours = parseInt(document.getElementById("family-hours") ? document.getElementById("family-hours").value : 4) || 4;
        total = base * count * (fhours / 4);
    } else if (cat === "errands") {
        var items = parseInt(document.getElementById("errand-items") ? document.getElementById("errand-items").value : 1) || 1;
        var dist = parseInt(document.getElementById("errand-distance") ? document.getElementById("errand-distance").value : 5) || 5;
        total = base + (base * 0.3 * (items - 1)) + (base * 0.1 * (dist / 5));
    } else if (cat === "appliance") {
        var appType = document.getElementById("appliance-type") ? document.getElementById("appliance-type").value : "ac";
        var appPrices = { ac: 120000, fridge: 85000, washer: 75000, oven: 65000, other: 55000 };
        total = appPrices[appType] || base;
    } else if (cat === "gardening") {
        var gsize = parseInt(document.getElementById("garden-size") ? document.getElementById("garden-size").value : 50) || 50;
        var gtype = document.getElementById("garden-service") ? document.getElementById("garden-service").value : "basic";
        total = base * (gsize / 50);
        if (gtype === "full") total *= 1.6;
    } else if (cat === "event") {
        var tent = document.getElementById("event-tent") ? document.getElementById("event-tent").checked : false;
        var chairs = document.getElementById("event-chairs") ? document.getElementById("event-chairs").checked : false;
        var sound = document.getElementById("event-sound") ? document.getElementById("event-sound").checked : false;
        total = 0;
        if (tent) total += 120000;
        if (chairs) total += 45000;
        if (sound) total += 85000;
        if (total === 0) total = base;
    } else if (cat === "auto") {
        var autoType = document.getElementById("auto-service") ? document.getElementById("auto-service").value : "basic";
        var autoPrices = { basic: 45000, full: 95000, interior: 55000 };
        total = autoPrices[autoType] || base;
    }

    currentService.currentPrice = Math.round(total);
    return Math.round(total);
}

async function placeOrder(event) {
    event.preventDefault();
    if (!window.__HAVENGO_JWT__) { addInAppAlert("info", "Please login first to place an order"); showAuthModal("login"); return; }
    if (!currentService) return;
    var finalPrice = calculateDynamicPrice(currentService.id);
    var date = document.getElementById("booking-date").value;
    var time = document.getElementById("booking-time").value;
    var address = sanitizeInput(document.getElementById("address-input").value.trim());
    var instructions = sanitizeInput(document.getElementById("special-instructions").value.trim());

    if (!date || !time || !address) {
        addInAppAlert("error", "Please fill in date, time and address");
        return;
    }

    var finalPrice = calculateDynamicPrice(currentService.id);
    var apiUrl = HAVENGO_BACKEND_URL + "/api";

    // Attempt to fetch fresh balance from backend (non-blocking — if server is sleeping, use cached balance)
    try {
        var balResp = await fetch(apiUrl + "/customer/profile", {
            headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ },
            signal: AbortSignal.timeout(25000)
        });
        if (balResp.ok) {
            var balData = await balResp.json();
            userBalance = balData.balance !== undefined ? balData.balance : userBalance;
        }
    } catch(e) { console.warn(e); }

    if (userBalance < finalPrice) {
        addInAppAlert("error", "Insufficient balance. Please deposit at least UGX " + finalPrice.toLocaleString() + " to book this service.");
        closeModal("checkout-modal");
        showDepositModal();
        return;
    }

    var assignedProvider = currentSelectedProvider || "";
    if (!assignedProvider) {
        for (var pi = 0; pi < registeredProviders.length; pi++) {
            var rp = registeredProviders[pi];
            if (rp.services) {
                for (var ps = 0; ps < rp.services.length; ps++) {
                    if (rp.services[ps].id === currentService.id) { assignedProvider = rp.business_name || rp.businessName || rp.name; break; }
                }
            }
            if (assignedProvider) break;
        }
    }
    try {
        var orderResp = await fetch(apiUrl + "/customer/place-order", {
            method: "POST",
            headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
            body: JSON.stringify({
                serviceId: currentService.id, serviceName: currentService.name,
                providerName: assignedProvider, price: finalPrice,
                address: address, details: instructions + " | Date: " + date + " Time: " + time
            }),
            signal: AbortSignal.timeout(30000)
        });
            var orderData = await orderResp.json();
            if (orderData.success) {
                var booking = {
                    id: orderData.taskId || orderData.id || Date.now(),
                    serviceId: currentService.id,
                    serviceName: currentService.name,
                    price: finalPrice,
                    date: date, time: time, address: address, instructions: instructions,
                    status: "Pending",
                    customerName: currentUser ? (currentUser.name || currentUser.firstname + " " + currentUser.lastname) : "Guest User",
                    customerPhone: currentUser ? currentUser.phone : "+256 777 062 518",
                    providerName: assignedProvider
                };
                bookings.push(booking);
                providerTasks.push({
                    id: booking.id,
                    serviceName: booking.serviceName,
                    customerName: booking.customerName,
                    customerPhone: booking.customerPhone,
                    address: booking.address,
                    date: booking.date,
                    time: booking.time,
                    price: booking.price,
                    status: "pending_confirmation",
                    instructions: booking.instructions,
                    providerName: assignedProvider
                });
                // Payment will be deducted when provider completes the task
                closeModal("checkout-modal");
                renderBookings();
                renderProfilePage();
                addNotification("\uD83D\uDCCB", "New Booking Placed", currentService.name + " on " + date + " at " + time);
                addActivity("booking", "Booked " + currentService.name + " for " + date);
                addInAppAlert("success", "Order placed successfully! Waiting for provider confirmation.");
                saveAppState();
                return;
            }
            if (orderData.session_expired) { handleSessionExpired(); return; }
            if (orderData.error) { addInAppAlert("error", orderData.error); return; }
        } catch(e) {
            addInAppAlert("error", "Cannot reach server. It may be waking up — please try again in 30 seconds.");
            return;
        }
        addInAppAlert("error", "Failed to place order on server. Please try again.");
    }

// Fetch customer bookings from backend for cross-browser sync
async function fetchCustomerBookings() {
    if (!window.__HAVENGO_JWT__ || !currentUser) return;
    try {
        var resp = await fetch(HAVENGO_BACKEND_URL + "/api/customer/bookings", {
            headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }
        });
        if (resp.ok) {
            var data = await resp.json();
            var allTasks = (data.active || []).concat(data.completed || []);
            var snap = allTasks.map(function(t){return (t.id||t.task_id)+':'+(t.status||'')}).join(',');
            if (snap === window.__lastBookingSnap) return;
            window.__lastBookingSnap = snap;
            // Replace local bookings with backend data (online-only)
            bookings = [];
            for (var bi = 0; bi < allTasks.length; bi++) {
                var b = allTasks[bi];
                var bookingDate = "", bookingTime = "";
                if (b.details) {
                    var dateMatch = b.details.match(/Date:\s*([^|]+)/);
                    var timeMatch = b.details.match(/Time:\s*([^|]+)/);
                    if (dateMatch) bookingDate = dateMatch[1].trim();
                    if (timeMatch) bookingTime = timeMatch[1].trim();
                }
                var status = b.status || "Pending";
                if (status === "pending_confirmation") status = "Pending";
                else if (status === "active") status = "In Progress";
                bookings.push({
                    id: b.id || b.task_id,
                    serviceId: b.service_id || "",
                    serviceName: b.service_name || "Service",
                    price: b.price || 0,
                    date: bookingDate,
                    time: bookingTime,
                    address: b.address || "",
                    status: status,
                    customerName: currentUser ? currentUser.name : "",
                    customerPhone: currentUser ? currentUser.phone : "",
                    providerName: b.provider_name || "",
                    details: b.details || ""
                });
            }
            renderBookings();
        }
    } catch(e) { console.warn(e); }
}

function renderBookings() {
    var list = document.getElementById("bookings-list");
    if (!list) return;
    if (bookings.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-12\"><i class=\"fa-solid fa-calendar-xmark text-5xl mb-4\"></i><p class=\"text-xl font-medium\">No bookings yet</p><p class=\"text-sm\">Book a service to see it here.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < bookings.length; i++) {
        var b = bookings[i];
        html += "<div class=\"bg-white rounded-3xl p-6 shadow\">" +
            "<div class=\"flex justify-between items-start\">" +
            "<div><div class=\"flex items-center gap-3 mb-2\">" +
            "<span class=\"text-2xl\">" + (serviceEmojis[b.serviceId] || "\uD83D\uDCCB") + "</span>" +
            "<h3 class=\"font-bold text-xl\">" + b.serviceName + "</h3></div>" +
            "<p class=\"text-sm text-gray-500\">" + b.date + " at " + b.time + "</p>" +
            "<p class=\"text-sm text-gray-500\">" + b.address + "</p>" +
            (b.providerName ? "<p class=\"text-sm text-emerald-600 mt-1\">Provider: " + b.providerName + "</p>" : "") + "</div>" +
            "<div class=\"text-right\"><span class=\"bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-xs font-medium\">" + b.status + "</span>" +
            "<p class=\"font-bold text-emerald-600 mt-2\">UGX " + b.price.toLocaleString() + "</p></div></div>" +
            "<div class=\"flex gap-3 mt-4 pt-4 border-t\">" +
            "<button onclick=\"startTracking(" + b.id + ")\" class=\"text-sm bg-emerald-600 text-white px-4 py-2 rounded-2xl\"><i class=\"fa-solid fa-location-dot\"></i> Track</button>" +
            "<button onclick=\"openChatWithProvider(" + b.id + ")\" class=\"text-sm border px-4 py-2 rounded-2xl\"><i class=\"fa-solid fa-comment\"></i> Chat</button>" +
            (b.status === "Completed" ? "<button onclick=\"rateBooking(" + b.id + ")\" class=\"text-sm bg-yellow-500 text-white px-4 py-2 rounded-2xl\"><i class=\"fa-solid fa-star\"></i> Rate</button>" : "") +
            (b.status === "Completed" ? "<button onclick=\"showPaymentsPending()\" class=\"text-sm bg-emerald-600 text-white px-4 py-2 rounded-2xl\"><i class=\"fa-solid fa-credit-card\"></i> Pay Now</button>" : "") +
            (b.status === "Pending" ? "<button onclick=\"customerCancelBooking(" + b.id + ")\" class=\"text-sm bg-red-500 text-white px-4 py-2 rounded-2xl\"><i class=\"fa-solid fa-ban\"></i> Cancel</button>" : "") +
            (b.status === "In Progress" ? "<span class=\"text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl\"><i class=\"fa-solid fa-info-circle\"></i> Contact provider via Chat to cancel</span>" : "") + "</div></div>";
    }
    list.innerHTML = html;
}

function customerCancelBooking(bookingId) {
    showAppPrompt("Please provide the reason for cancelling this order:", "", function(reason) {
        if (!reason || reason.trim() === "") { addInAppAlert("error", "A cancellation reason is required."); return; }
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        (async function() {
            if (window.__HAVENGO_JWT__) {
                try {
                    var resp = await fetch(apiUrl + "/customer/cancel-booking/" + bookingId, {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                        body: JSON.stringify({ reason: reason.trim() })
                    });
                    var data = await resp.json();
                    if (data.success || resp.ok) {
                        for (var i = 0; i < bookings.length; i++) {
                            if (bookings[i].id === bookingId) { bookings[i].status = "Cancelled"; break; }
                        }
                        for (var pi = 0; pi < providerTasks.length; pi++) {
                            if (providerTasks[pi].id === bookingId) { providerTasks.splice(pi, 1); break; }
                        }
                        for (var ati = 0; ati < adminTasks.length; ati++) {
                            if (adminTasks[ati].id === bookingId) { adminTasks.splice(ati, 1); break; }
                        }
                        addNotification("\u274C", "Order Cancelled", "Order #" + bookingId + " cancelled. Reason: " + reason);
                        renderBookings();
                        saveAppState();
                        addInAppAlert("success", "Order cancelled. Reason sent to provider.");
                        return;
                    }
                } catch(e) { console.warn(e); }
            }
            // Fallback local
            for (var i = 0; i < bookings.length; i++) {
                if (bookings[i].id === bookingId) { bookings[i].status = "Cancelled"; break; }
            }
            for (var pi = 0; pi < providerTasks.length; pi++) {
                if (providerTasks[pi].id === bookingId) { providerTasks.splice(pi, 1); break; }
            }
            for (var ati = 0; ati < adminTasks.length; ati++) {
                if (adminTasks[ati].id === bookingId) { adminTasks.splice(ati, 1); break; }
            }
            addNotification("\u274C", "Order Cancelled", "Order #" + bookingId + " cancelled. Reason: " + reason);
            renderBookings();
            saveAppState();
            addInAppAlert("success", "Order cancelled. Reason sent to provider.");
        })();
    });
}

// ============================================================
// PROVIDER FUNCTIONS
// ============================================================

async function loginAsProvider() {
    var identifier = document.getElementById("prov-login-id");
    var password = document.getElementById("prov-login-pass");
    var idVal = identifier ? sanitizeInput(identifier.value.trim()) : "";
    var passVal = password ? password.value : "";

    if (!idVal || !passVal) {
        addInAppAlert("error", "Please enter your provider credentials");
        return;
    }

    var apiUrl = HAVENGO_BACKEND_URL + "/api";

    try {
        var resp = await fetch(apiUrl + "/provider/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: idVal, password: passVal }),
            signal: AbortSignal.timeout(35000)
        });
        var data = await resp.json();
        if (data.success) {
            var p = data.provider;
            window.__HAVENGO_JWT__ = data.token;
            currentLoggedProvider = {
                id: p.id,
                name: p.firstname + " " + p.lastname,
                firstname: p.firstname,
                lastname: p.lastname,
                service: (typeof p.services === "string" ? p.services : "General Services"),
                services: parseProviderServices(p.services),
                location: p.location || "",
                phone: p.phone,
                email: p.email,
                password: "",
                bitmoji: p.bitmoji || "\uD83D\uDD27",
                bio: p.bio || "",
                verified: true,
                business_name: p.business_name || "",
                registration_fee_paid: p.registration_fee_paid || 0
            };
            currentLoggedProvider.total_earnings = p.total_earnings || 0;
            enterProviderDashboard(currentLoggedProvider);
            return;
        }
        if (resp.status === 403) {
            addInAppAlert("error", "Your account is pending admin verification. Please wait for an administrator to approve your application before logging in.");
            return;
        }
        if (data.error) { addInAppAlert("error", data.error); return; }
    } catch(e) {
        addInAppAlert("error", "Cannot log in: Server is currently unavailable. Please try again later.");
        return;
    }
    addInAppAlert("error", "Cannot log in: Server is currently unavailable. Please try again later.");
}

async function enterProviderDashboard(provider) {
    // Restore provider notifications
    if (provider.email && userNotificationsMap[provider.email]) {
        globalNotifications = userNotificationsMap[provider.email].slice();
        delete userNotificationsMap[provider.email];
    }
    document.getElementById("provider-login-screen").classList.add("hidden");
    document.getElementById("provider-dashboard").classList.remove("hidden");
    document.getElementById("provider-header").classList.remove("hidden");
    document.getElementById("logged-provider-name").textContent = provider.business_name || provider.name;
    document.getElementById("logged-provider-service").textContent = provider.service + " \u2022 " + provider.location;
    document.getElementById("prov-login-id").value = "";
    document.getElementById("prov-login-pass").value = "";

    // Fetch provider tasks from backend if available
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    if (window.__HAVENGO_JWT__) {
        try {
            var tasksResp = await fetch(apiUrl + "/provider/tasks", { headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }, signal: AbortSignal.timeout(35000) });
            if (tasksResp.ok) {
                var backendTasks = await tasksResp.json();
                providerTasks = [];
                for (var ti = 0; ti < backendTasks.length; ti++) {
                    var bt = backendTasks[ti];
                    providerTasks.push({
                        id: bt.id,
                        serviceId: bt.service_id,
                        serviceName: bt.service_name,
                        customerName: "",
                        customerPhone: "",
                        address: bt.address || "",
                        date: "",
                        time: "",
                        price: bt.price,
                        instructions: bt.details || "",
                        providerName: bt.provider_name || "",
                        status: bt.status
                    });
                }
            }
            var compResp = await fetch(apiUrl + "/provider/completed-tasks", { headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }, signal: AbortSignal.timeout(35000) });
            if (compResp.ok) {
                var backendCompleted = await compResp.json();
                completedTasks = [];
                providerEarningsMap = {};
                for (var ci = 0; ci < backendCompleted.length; ci++) {
                    var bc = backendCompleted[ci];
                    completedTasks.push({
                        id: bc.id,
                        taskId: bc.task_id,
                        serviceName: bc.service_name,
                        customerName: bc.customer_email,
                        price: bc.price,
                        providerName: bc.provider_name,
                        date: bc.completed_at,
                        paid: bc.paid
                    });
                    if (bc.paid && bc.provider_name) {
                        providerEarningsMap[bc.provider_name] = (providerEarningsMap[bc.provider_name] || 0) + Math.round(bc.price * 0.85);
                    }
                }
            }
        } catch(e) { console.warn(e); }
    }

    renderProviderDashboard();
    fetchBackendNotifications();
    addNotification("\uD83D\uDD10", "Provider Login", provider.name + " logged into dashboard");
    if (!provider.registration_fee_paid) {
        setTimeout(function() { showProviderPaymentPrompt(); }, 1000);
    }

    // Start provider polling every 30s for cross-browser task sync
    if (window.__providerPollInterval) clearInterval(window.__providerPollInterval);
    window.__providerPollInterval = setInterval(async function() {
        if (!window.__HAVENGO_JWT__ || !currentLoggedProvider) return;
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        try {
            var tasksResp = await fetch(apiUrl + "/provider/tasks", { headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }, signal: AbortSignal.timeout(35000) });
            if (tasksResp.ok) {
                var backendTasks = await tasksResp.json();
                var prevCount = providerTasks.length;
                providerTasks = [];
                for (var ti = 0; ti < backendTasks.length; ti++) {
                    var bt = backendTasks[ti];
                    providerTasks.push({
                        id: bt.id, serviceId: bt.service_id, serviceName: bt.service_name,
                        customerName: bt.customer_email || "", customerPhone: "", address: bt.address || "",
                        date: "", time: "", price: bt.price, instructions: bt.details || "",
                        providerName: bt.provider_name || "", status: bt.status
                    });
                }
                if (providerTasks.length > prevCount) {
                    addNotification("\uD83D\uDCE2", "New Order Received", "You have " + (providerTasks.length - prevCount) + " new order(s) to review!");
                }
                var compResp = await fetch(apiUrl + "/provider/completed-tasks", { headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }, signal: AbortSignal.timeout(35000) });
                if (compResp.ok) {
                    var backendCompleted = await compResp.json();
                    completedTasks = [];
                    providerEarningsMap = {};
                    for (var ci = 0; ci < backendCompleted.length; ci++) {
                        var bc = backendCompleted[ci];
                        completedTasks.push({
                            id: bc.id, taskId: bc.task_id, serviceName: bc.service_name,
                            customerName: bc.customer_email, price: bc.price,
                            providerName: bc.provider_name, date: bc.completed_at, paid: bc.paid
                        });
                        if (bc.paid && bc.provider_name) {
                            var key = bc.provider_name;
                            providerEarningsMap[key] = (providerEarningsMap[key] || 0) + Math.round(bc.price * 0.85);
                        }
                    }
                }
                var snap = providerTasks.map(function(t){return t.id+':'+t.status}).join(',') + '|' + completedTasks.map(function(t){return t.id+':'+t.paid}).join(',');
                if (snap !== window.__lastProvSnap) {
                    renderProviderDashboard();
                    window.__lastProvSnap = snap;
                }
            }
            // Background sync provider-admin chat messages
            var provEmail = currentLoggedProvider.email || currentLoggedProvider.name || "unknown";
            var chatId = "provider-admin-" + provEmail;
            if (chatConversations[chatId]) {
                await loadChatFromStorage(chatId);
            }
            // Fetch backend notifications
            fetchBackendNotifications();
        } catch(e) { console.warn(e); }
    }, 30000);
}

function logoutProvider() {
    // This override is defined later with confirm dialog
}

function switchProviderTab(n) {
    var btns = document.querySelectorAll("#provider-dashboard .tab-button");
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("border-emerald-600", i === n);
        btns[i].classList.toggle("font-medium", i === n);
        btns[i].classList.toggle("text-gray-500", i !== n);
    }
    var tabs = document.querySelectorAll("#provider-dashboard .provider-tab");
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("hidden", i !== n);
    }
    if (n === 3) renderProviderPriceList();
    window.__providerTab = n;
    saveAppState();
}

function renderProviderDashboard() {
    if (!currentLoggedProvider) return;
    // Show/hide registration fee banner
    var feeBanner = document.getElementById("registration-fee-banner");
    if (feeBanner) {
        feeBanner.classList.toggle("hidden", !!(currentLoggedProvider.registration_fee_paid));
    }
    var provName = currentLoggedProvider.name;
    var provBizName = currentLoggedProvider.business_name || "";
    var myTasks = providerTasks.filter(function(t) { return t.providerName === provName || t.providerName === provBizName || t.providerName === ""; });
    var myCompleted = completedTasks.filter(function(t) { return t.providerName === provName || t.providerName === provBizName; });
    var today = new Date().toDateString();
    var todayCount = 0;
    for (var i = 0; i < myTasks.length; i++) {
        if (myTasks[i].date && new Date(myTasks[i].date).toDateString() === today) {
            todayCount++;
        }
    }
    document.getElementById("today-tasks-count").textContent = todayCount;
    var provEarnings = currentLoggedProvider.total_earnings || providerEarningsMap[provName] || providerEarningsMap[provBizName] || 0;
    document.getElementById("monthly-earnings").textContent = provEarnings.toLocaleString();
    var total = myTasks.length + myCompleted.length;
    var rate = total === 0 ? 0 : Math.round((myCompleted.length / total) * 100);
    document.getElementById("completion-rate").textContent = rate + "%";

    var activeList = document.getElementById("active-tasks-list");
    if (activeList) {
        var activeTasks = myTasks.filter(function(t) { return t.status === "pending_confirmation" || t.status === "active"; });
        if (activeTasks.length === 0) {
            activeList.innerHTML = "<div class=\"text-center text-gray-500 py-12\"><i class=\"fa-solid fa-list-check text-5xl mb-4\"></i><p class=\"text-xl font-medium\">No active tasks</p></div>";
        } else {
            var html = "";
            for (var i = 0; i < activeTasks.length; i++) {
                var t = activeTasks[i];
                html += "<div class=\"bg-white rounded-3xl p-6 shadow\">" +
                    "<div class=\"flex justify-between items-start\">" +
                    "<div><h3 class=\"font-bold text-xl\">" + t.serviceName + "</h3>" +
                    "<p class=\"text-sm text-gray-600\"><strong>Customer:</strong> " + t.customerName + "</p>" +
                    "<p class=\"text-sm text-gray-600\"><strong>Phone:</strong> " + t.customerPhone + "</p>" +
                    "<p class=\"text-sm text-gray-600\"><strong>Address:</strong> " + t.address + "</p>" +
                    "<p class=\"text-sm text-gray-600\"><strong>Date:</strong> " + t.date + " at " + t.time + "</p>" +
                    "<p class=\"text-sm text-gray-600\"><strong>Price:</strong> UGX " + t.price.toLocaleString() + "</p>" +
                    (t.instructions ? "<p class=\"text-sm text-gray-600\"><strong>Instructions:</strong> " + t.instructions + "</p>" : "") +
                    "</div>" +
                    "<div><span class=\"bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-medium\">" + t.status + "</span></div></div>" +
                    (t.status === "pending_confirmation" ? "<div class=\"mt-4 pt-4 border-t\"><button onclick=\"confirmProviderTask(" + t.id + ")\" class=\"bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-2xl text-sm\"><i class=\"fa-solid fa-check\"></i> Confirm Order</button></div>" : "") +
                    (t.status === "active" ? "<div class=\"mt-4 pt-4 border-t flex gap-3 flex-wrap\"><button onclick=\"completeProviderTask(" + t.id + ")\" class=\"bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-2xl text-sm\"><i class=\"fa-solid fa-check-double\"></i> Mark Complete</button><button onclick=\"startProviderTracking(" + t.id + ")\" class=\"bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-2xl text-sm\"><i class=\"fa-solid fa-location-dot\"></i> Share Location</button><button onclick=\"cancelProviderTask(" + t.id + ")\" class=\"bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-2xl text-sm\"><i class=\"fa-solid fa-ban\"></i> Cancel Order</button></div>" : "") +
                    "</div>";
            }
            activeList.innerHTML = html;
        }
    }

    var completedList = document.getElementById("completed-tasks-list");
    if (completedList) {
        if (myCompleted.length === 0) {
            completedList.innerHTML = "<div class=\"text-center text-gray-500 py-12\"><i class=\"fa-solid fa-circle-check text-5xl mb-4\"></i><p class=\"text-xl font-medium\">No completed tasks</p></div>";
        } else {
            var html2 = "";
            for (var i = 0; i < myCompleted.length; i++) {
                var ct = myCompleted[i];
                html2 += "<div class=\"bg-white rounded-3xl p-6 shadow\">" +
                    "<div class=\"flex justify-between items-start\">" +
                    "<div><h3 class=\"font-bold text-xl\">" + ct.serviceName + "</h3>" +
                    "<p class=\"text-sm text-gray-600\">" + ct.customerName + " \u2022 " + ct.date + "</p>" +
                    "</div>" +
                    "<div><span class=\"bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-medium\">Completed</span>" +
                    "<p class=\"font-bold text-emerald-600 mt-2\">UGX " + ct.price.toLocaleString() + "</p></div></div></div>";
            }
            completedList.innerHTML = html2;
        }
    }

    // Earnings list
    var earningsList = document.getElementById("earnings-list");
    if (earningsList) {
        var provName2 = currentLoggedProvider.name;
        var provBizName2 = currentLoggedProvider.business_name || "";
        var myCompleted2 = completedTasks.filter(function(t) { return t.providerName === provName2 || t.providerName === provBizName2; });
        if (myCompleted2.length === 0) {
            earningsList.innerHTML = "<div class=\"text-center text-gray-500 py-6\"><i class=\"fa-solid fa-wallet text-4xl mb-3\"></i><p>No earnings yet. Complete tasks to earn.</p></div>";
        } else {
            var ehtml = "";
            for (var ei = 0; ei < myCompleted2.length; ei++) {
                var et = myCompleted2[ei];
                ehtml += "<div class=\"flex justify-between items-center border-b pb-3\"><div><p class=\"font-medium\">" + et.serviceName + "</p><p class=\"text-xs text-gray-500\">" + et.customerName + " \u2022 " + et.date + "</p></div><p class=\"font-bold text-emerald-600\">UGX " + et.price.toLocaleString() + "</p></div>";
            }
            var totalPaid = providerEarningsMap[provName2] || providerEarningsMap[provBizName2] || 0;
            ehtml += "<div class=\"flex justify-between items-center pt-3 mt-3 border-t-2\"><p class=\"font-bold\">Total Paid</p><p class=\"font-bold text-emerald-600 text-lg\">UGX " + totalPaid.toLocaleString() + "</p></div>";
            earningsList.innerHTML = ehtml;
        }
    }
    renderProviderPriceList();
}

async function confirmProviderTask(taskId) {
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    if (window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(apiUrl + "/provider/confirm-task/" + taskId, {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }
            });
            if (resp.ok) {
                for (var i = 0; i < providerTasks.length; i++) {
                    if (providerTasks[i].id === taskId) {
                        providerTasks[i].status = "active";
                        providerTasks[i].providerName = currentLoggedProvider.name;
                        break;
                    }
                }
                for (var j = 0; j < bookings.length; j++) {
                    if (bookings[j].id === taskId) { bookings[j].status = "In Progress"; break; }
                }
                addNotification("\u2705", "Order Confirmed", currentLoggedProvider.name + " confirmed order #" + taskId);
                renderProviderDashboard();
                renderBookings();
                saveAppState();
                return;
            }
        } catch(e) { console.warn(e); }
    }
    // Fallback local
    for (var i = 0; i < providerTasks.length; i++) {
        if (providerTasks[i].id === taskId) {
            providerTasks[i].status = "active";
            providerTasks[i].providerName = currentLoggedProvider.name;
            break;
        }
    }
    for (var j = 0; j < bookings.length; j++) {
        if (bookings[j].id === taskId) { bookings[j].status = "In Progress"; break; }
    }
    addNotification("\u2705", "Order Confirmed", currentLoggedProvider.name + " confirmed order #" + taskId);
    renderProviderDashboard();
    renderBookings();
    saveAppState();
}

async function cancelProviderTask(taskId) {
    showAppPrompt("Please provide the reason for cancelling this order:", "", function(reason) {
        if (!reason || reason.trim() === "") { addInAppAlert("error", "A cancellation reason is required."); return; }
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        if (window.__HAVENGO_JWT__) {
            (async function() {
                try {
                    var resp = await fetch(apiUrl + "/provider/cancel-task/" + taskId, {
                        method: "POST",
                        headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                        body: JSON.stringify({ reason: reason.trim() })
                    });
                    var data = await resp.json();
                    if (data.success) {
                        for (var i = 0; i < providerTasks.length; i++) {
                            if (providerTasks[i].id === taskId) {
                                providerTasks.splice(i, 1);
                                break;
                            }
                        }
                        for (var ati = 0; ati < adminTasks.length; ati++) {
                            if (adminTasks[ati].id === taskId) { adminTasks.splice(ati, 1); break; }
                        }
                        for (var j = 0; j < bookings.length; j++) {
                            if (bookings[j].id === taskId) {
                                bookings[j].status = "Cancelled";
                                break;
                            }
                        }
                        addNotification("\u274C", "Order Cancelled", "Order #" + taskId + " cancelled. Reason: " + reason);
                        renderProviderDashboard();
                        renderBookings();
                        saveAppState();
                        addInAppAlert("success", "Order cancelled successfully. Customer has been notified.");
                        return;
                    }
                    if (data.error) { addInAppAlert("error", data.error); return; }
                } catch(e) { addInAppAlert("error", "Network error cancelling task"); return; }
            })();
        } else {
            addInAppAlert("error", "You must be logged in to cancel an order");
        }
    });
}

async function completeProviderTask(taskId) {
    var task = null;
    var taskIdx = -1;
    for (var i = 0; i < providerTasks.length; i++) {
        if (providerTasks[i].id === taskId) { task = providerTasks[i]; taskIdx = i; break; }
    }
    if (!task) return;
    showAppConfirm("Mark this task as complete? This will notify the customer to confirm payment.", async function(confirmed) {
        if (!confirmed) return;
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        if (window.__HAVENGO_JWT__) {
            try {
                var resp = await fetch(apiUrl + "/provider/complete-task/" + taskId, {
                    method: "POST",
                    headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }
                });
                if (!resp.ok) { addInAppAlert("error", "Failed to complete task on server"); return; }
            } catch(e) { addInAppAlert("error", "Network error completing task"); return; }
        }
        providerTasks.splice(taskIdx, 1);
        // Remove from admin tasks as well
        for (var ati = 0; ati < adminTasks.length; ati++) {
            if (adminTasks[ati].id === task.id) { adminTasks.splice(ati, 1); break; }
        }
        var completed = {
        id: task.id,
        serviceName: task.serviceName,
        customerName: task.customerName,
        customerPhone: task.customerPhone,
        address: task.address,
        date: task.date,
        time: task.time,
        price: task.price,
        instructions: task.instructions,
        providerName: task.providerName || currentLoggedProvider.name,
        completedAt: Date.now()
    };
    completedTasks.push(completed);
    var payDeadline = Date.now() + 36000000; // 10 hours
    pendingPayments.push({
        id: Date.now(),
        taskId: task.id,
        taskName: task.serviceName,
        amount: task.price,
        providerName: completed.providerName,
        customerName: task.customerName,
        completedAt: Date.now(),
        deadline: payDeadline,
        paid: false
    });
    for (var j = 0; j < bookings.length; j++) {
        if (bookings[j].id === task.id) { bookings[j].status = "Completed"; break; }
    }
    addNotification("\u2705", "Task Completed", currentLoggedProvider.name + " completed " + task.serviceName + ". Payment of UGX " + task.price.toLocaleString() + " is pending.");
    renderProviderDashboard();
    renderBookings();
    saveAppState();
    });
}

function renderProviderPriceList() {
    var container = document.getElementById("provider-price-list");
    if (!container || !currentLoggedProvider) return;
    var provServices = currentLoggedProvider.services || [];
    if (provServices.length === 0) {
        container.innerHTML = "<div class=\"text-center text-gray-500 py-6\"><p>No services assigned to your account.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < provServices.length; i++) {
        var s = provServices[i];
        var currentPrice = s.basePrice;
        html += "<div class=\"bg-gray-50 rounded-2xl p-5\"><div class=\"flex justify-between items-center\"><div><h4 class=\"font-semibold\">" + s.name + "</h4><p class=\"text-sm text-gray-500\">Current: UGX " + currentPrice.toLocaleString() + "</p></div></div><div class=\"flex gap-3 mt-3 items-end\"><div><label class=\"text-xs text-gray-500 block mb-1\">New Price (UGX)</label><input type=\"number\" id=\"price-input-" + s.id + "\" value=\"" + currentPrice + "\" min=\"10000\" class=\"w-40 border rounded-xl px-4 py-2 text-sm\"></div><button onclick=\"requestPriceChange('" + s.id + "','" + s.name + "')\" class=\"bg-emerald-600 text-white px-5 py-2 rounded-xl text-sm hover:bg-emerald-700\"><i class=\"fa-solid fa-paper-plane\"></i> Request Change</button></div></div>";
    }
    container.innerHTML = html;
}

async function requestPriceChange(serviceId, serviceName) {
    if (!currentLoggedProvider) return;
    var input = document.getElementById("price-input-" + serviceId);
    if (!input) return;
    var newPrice = parseInt(input.value);
    if (!newPrice || newPrice < 10000) { addInAppAlert("error", "Please enter a valid price (minimum 10,000 UGX)"); return; }
    var currentPrice = 0;
    var services = currentLoggedProvider.services || [];
    for (var i = 0; i < services.length; i++) {
        if (services[i].id === serviceId) { currentPrice = services[i].basePrice; break; }
    }

    // Try backend first
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    if (window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(apiUrl + "/provider/price-request", {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                body: JSON.stringify({ serviceId: serviceId, currentPrice: currentPrice, requestedPrice: newPrice })
            });
            if (resp.ok) {
                addInAppAlert("success", "Price change request submitted for " + serviceName + ". Admin will review it shortly.");
                addNotification("\uD83D\uDCCB", "Price Request Submitted", "Price change for " + serviceName + " sent to admin.");
                return;
            }
        } catch(e) { console.warn(e); }
    }

    priceChangeRequests.push({
        id: Date.now(),
        providerName: currentLoggedProvider.name,
        providerEmail: currentLoggedProvider.email || "",
        serviceId: serviceId,
        serviceName: serviceName,
        currentPrice: currentPrice,
        requestedPrice: newPrice,
        status: "pending",
        date: new Date().toLocaleString()
    });
    addInAppAlert("success", "Price change request submitted for " + serviceName + ". Admin will review it shortly.");
    addNotification("\uD83D\uDCC8", "Price Change Requested", currentLoggedProvider.name + " requested price change for " + serviceName + ": UGX " + currentPrice.toLocaleString() + " \u2192 UGX " + newPrice.toLocaleString());
    saveAppState();
}

async function payRegistrationFee() {
    if (!currentLoggedProvider) return;
    var phone = document.getElementById("payment-phone-input").value.trim();
    if (!phone || phone.length < 8) { addInAppAlert("error", "Please enter your Mobile Money phone number"); return; }
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    if (window.__HAVENGO_JWT__) {
        try {
            addInAppAlert("info", "Processing Mobile Money payment from " + phone + "...");
            var resp = await fetch(apiUrl + "/provider/pay-registration-fee", {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }
            });
            if (resp.ok) {
                currentLoggedProvider.registration_fee_paid = 1;
                renderProviderDashboard();
                renderProfilePage();
                addNotification("\u2705", "Registration Complete", "Your account is now active. You can receive orders!");
                addInAppAlert("success", "Payment of 50,000 UGX from " + phone + " successful! Your provider account is now active.");
                closeModal("payment-prompt-modal");
                saveAppState();
                return;
            }
            var data = await resp.json();
            if (data.error) { addInAppAlert("error", data.error); return; }
        } catch(e) { console.warn(e); }
    }
    addInAppAlert("error", "Payment failed: Server is currently unavailable. Please try again later.");
}

function showProviderPaymentPrompt() {
    document.getElementById("payment-phone-input").value = currentLoggedProvider.phone || "";
    document.getElementById("payment-prompt-modal").classList.remove("hidden");
}

async function loginAsAdmin() {
    var idVal = document.getElementById("admin-login-id").value.trim();
    var passVal = document.getElementById("admin-login-pass").value;
    var hashedInput = await hashPassword(passVal);
    if ((idVal === "thermypetson@gmail.com" || idVal === "0757532066") && hashedInput === ADMIN_PASSWORD_HASH) {
        adminLoginSuccess();
    } else {
        addInAppAlert("error", "Invalid admin credentials");
    }
}

function adminLoginSuccess() {
    currentAdmin = { name: "Admin", email: "thermypetson@gmail.com" };
    // Restore admin notifications
    if (userNotificationsMap["admin"]) {
        globalNotifications = userNotificationsMap["admin"].slice();
        delete userNotificationsMap["admin"];
    }
    closeAuthModal();
    document.getElementById("admin-login-screen").classList.add("hidden");
    document.getElementById("admin-dashboard").classList.remove("hidden");
    document.getElementById("admin-header").classList.remove("hidden");
    document.getElementById("admin-nav-link").classList.remove("hidden");
    document.getElementById("admin-login-id").value = "";
    document.getElementById("admin-login-pass").value = "";
    updateNotifCount();
    renderAdminDashboard();
    addNotification("\uD83D\uDD10", "Admin Login", "Admin logged into the portal");
    // Sync from backend
    _syncAdminData();
    fetchBackendNotifications();
    // Start admin polling every 30s
    if (window.__adminPollInterval) clearInterval(window.__adminPollInterval);
    window.__adminPollInterval = setInterval(function() {
        if (currentAdmin && window.__HAVENGO_JWT__) {
            _syncAdminData();
            fetchBackendNotifications();
        }
    }, 30000);
}

async function _syncAdminData() {
    try {
        var token = window.__HAVENGO_JWT__;
        if (!token) return;
        var headers = { "Authorization": "Bearer " + token };
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        // Fetch providers
        var provResp = await fetch(apiUrl + "/admin/providers", { headers: headers, signal: AbortSignal.timeout(35000) });
        if (provResp.ok) {
            var providers = await provResp.json();
            registeredProviders = providers.map(function(p) {
                return {
                    id: p.id,
                    name: p.firstname + " " + p.lastname,
                    firstname: p.firstname,
                    lastname: p.lastname,
                    email: p.email,
                    phone: p.phone,
                    businessName: p.business_name,
                    service: p.services,
                    services: parseProviderServices(p.services),
                    bitmoji: p.bitmoji,
                    verified: p.verified === 1,
                    total_earnings: p.total_earnings,
                    location: p.location || "",
                    bio: p.bio || "",
                    experience: p.experience || 0
                };
            });
        }
        // Fetch revenue
        var revResp = await fetch(apiUrl + "/admin/revenue", { headers: headers, signal: AbortSignal.timeout(35000) });
        if (revResp.ok) {
            var rev = await revResp.json();
            adminRevenueData = rev;
        }
        // Fetch users
        var usersResp = await fetch(apiUrl + "/admin/users", { headers: headers, signal: AbortSignal.timeout(35000) });
        if (usersResp.ok) {
            allUsers = await usersResp.json();
        }
        // Fetch price requests
        var prResp = await fetch(apiUrl + "/admin/price-requests", { headers: headers, signal: AbortSignal.timeout(35000) });
        if (prResp.ok) {
            var prs = await prResp.json();
            priceChangeRequests = [];
            for (var pri = 0; pri < prs.length; pri++) {
                priceChangeRequests.push({
                    id: prs[pri].id,
                    providerName: prs[pri].provider_name,
                    providerEmail: "",
                    serviceId: prs[pri].service_id,
                    serviceName: "",
                    currentPrice: prs[pri].current_price,
                    requestedPrice: prs[pri].requested_price,
                    status: prs[pri].status || "pending",
                    date: prs[pri].created_at
                });
            }
        }
        // Apply approved price changes to services array
        for (var ap = 0; ap < priceChangeRequests.length; ap++) {
            if (priceChangeRequests[ap].status === "approved") {
                var req = priceChangeRequests[ap];
                for (var sj = 0; sj < services.length; sj++) {
                    if (services[sj].id === req.serviceId) {
                        services[sj].basePrice = req.requestedPrice;
                        break;
                    }
                }
            }
        }
        // Fetch all active tasks for admin order tracking
        try {
            var tasksResp = await fetch(apiUrl + "/admin/tasks", { headers: headers, signal: AbortSignal.timeout(35000) });
            if (tasksResp.ok) {
                var bt = await tasksResp.json();
                adminTasks = bt.map(function(t) {
                    return {
                        id: t.id,
                        serviceName: t.service_name,
                        customerName: t.customer_email || "",
                        providerName: t.provider_name || "",
                        address: t.address || "",
                        price: t.price,
                        status: t.status,
                        details: t.details || "",
                        createdAt: t.created_at
                    };
                });
            }
        } catch(et) { console.warn(et); }
        // Fetch admin conversations from backend so admin sees all chats
        try {
            var convResp = await fetch(apiUrl + "/admin/chat/conversations", { headers: headers, signal: AbortSignal.timeout(35000) });
            if (convResp.ok) {
                var convIds = await convResp.json();
                for (var ci = 0; ci < convIds.length; ci++) {
                    var cid = convIds[ci];
                    if (!chatConversations[cid]) chatConversations[cid] = [];
                    // Fetch messages for this conversation
                    var msgResp = await fetch(apiUrl + "/admin/chat/" + encodeURIComponent(cid), { headers: headers, signal: AbortSignal.timeout(35000) });
                    if (msgResp.ok) {
                        var msgs = await msgResp.json();
                        // Preserve local-only messages (not yet on backend)
                        var localOnly = [];
                        var backendSet = {};
                        for (var bi = 0; bi < msgs.length; bi++) {
                            var backendSender = msgs[bi].sender === "Admin" ? "admin" : (msgs[bi].sender === "Customer" ? "customer" : msgs[bi].sender);
                            backendSet[msgs[bi].message + "_" + backendSender] = true;
                        }
                        for (var li = 0; li < chatConversations[cid].length; li++) {
                            var lm = chatConversations[cid][li];
                            if (!backendSet[lm.text + "_" + lm.sender]) {
                                localOnly.push(lm);
                            }
                        }
                        chatConversations[cid] = msgs.map(function(m) {
                            var sender = m.sender === "Admin" ? "admin" : m.sender;
                            if (currentUser && sender === currentUser.name) sender = "customer";
                            return { id: m.id, text: m.message, sender: sender, time: new Date(m.created_at).getTime(), created_at: m.created_at };
                        }).concat(localOnly);
                        checkNewChatMessages(cid);
                    }
                }
            }
        } catch(ec) { console.warn(ec); }
        var snap = registeredProviders.length + '|' + allUsers.length + '|' + adminTasks.length + '|' + priceChangeRequests.length + '|' + ((adminRevenueData && adminRevenueData.length) || 0);
        if (snap !== window.__lastAdminSnap) {
            renderAdminDashboard();
            renderAllProviderLists();
            window.__lastAdminSnap = snap;
        }
    } catch(e) { console.log("Backend sync error:", e); }
}

function logoutAdmin() {
    showAppConfirm("Are you sure you want to logout?", function(confirmed) {
        if (!confirmed) return;
        userNotificationsMap["admin"] = globalNotifications.slice();
        if (window.__adminPollInterval) clearInterval(window.__adminPollInterval);
        window.__HAVENGO_JWT__ = null;
        currentAdmin = null;
        globalNotifications = [];
        document.getElementById("admin-dashboard").classList.add("hidden");
        document.getElementById("admin-header").classList.add("hidden");
        document.getElementById("admin-nav-link").classList.add("hidden");
    });
}

function logoutProvider() {
    showAppConfirm("Are you sure you want to logout?", function(confirmed) {
        if (!confirmed) return;
        if (currentLoggedProvider && currentLoggedProvider.email) {
            userNotificationsMap[currentLoggedProvider.email] = globalNotifications.slice();
        }
        if (window.__providerPollInterval) clearInterval(window.__providerPollInterval);
        window.__HAVENGO_JWT__ = null;
        currentLoggedProvider = null;
        globalNotifications = [];
        document.getElementById("provider-login-screen").classList.remove("hidden");
        document.getElementById("provider-dashboard").classList.add("hidden");
        document.getElementById("provider-header").classList.add("hidden");
        document.getElementById("prov-login-id").value = "";
        document.getElementById("prov-login-pass").value = "";
        saveAppState();
    });
}

function switchAdminTab(n) {
    var btns = document.querySelectorAll(".admin-tab");
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("border-amber-600", i === n);
        btns[i].classList.toggle("font-medium", i === n);
        btns[i].classList.toggle("text-gray-500", i !== n);
    }
    var contents = document.querySelectorAll(".admin-content");
    for (var i = 0; i < contents.length; i++) {
        contents[i].classList.toggle("hidden", i !== n);
    }
    if (n === 0) renderAdminProviders();
    if (n === 1) renderAdminVerification();
    if (n === 2) renderAdminPriceRequests();
    if (n === 3) renderAdminRevenue();
    if (n === 4) renderAdminChat();
    if (n === 5) renderAdminOrders();
    window.__adminTab = n;
    saveAppState();
}

function renderAdminDashboard() {
    document.getElementById("admin-providers-count").textContent = registeredProviders.length;
    var pending = registeredProviders.filter(function(p) { return !p.verified; }).length;
    document.getElementById("admin-pending-count").textContent = pending || 0;
    document.getElementById("admin-price-requests").textContent = priceChangeRequests.length;
    var totalRev = 0;
    for (var i = 0; i < completedTasks.length; i++) {
        totalRev += Math.round(completedTasks[i].price * 0.15);
    }
    document.getElementById("admin-revenue").textContent = totalRev.toLocaleString() + " UGX";
    renderAdminProviders();
    renderAdminVerification();
    renderAdminPriceRequests();
    renderAdminRevenue();
    renderAdminChat();
}

function renderAdminProviders() {
    var list = document.getElementById("admin-providers-list");
    if (!list) return;
    if (registeredProviders.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-users text-4xl mb-3\"></i><p>No providers registered yet.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < registeredProviders.length; i++) {
        var p = registeredProviders[i];
        var isVerified = p.verified ? "<span class=\"text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full\">Verified</span>" : "<span class=\"text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full\">Pending</span>";
        var displayName = p.business_name || p.businessName || p.name;
        html += "<div class=\"bg-white rounded-2xl p-5 shadow flex justify-between items-center\"><div><p class=\"font-semibold\">" + displayName + "</p><p class=\"text-sm text-gray-500\">" + (p.email || "") + " \u2022 " + (p.phone || "") + "</p><p class=\"text-xs text-gray-400\">" + (p.service || "General") + " \u2022 " + (p.location || "") + "</p></div><div>" + isVerified + " <button onclick=\"adminDeleteProvider(" + p.id + ")\" class=\"text-xs bg-red-500 text-white px-2 py-1 rounded-full ml-2 hover:bg-red-600\"><i class=\"fa-solid fa-trash-can\"></i> Delete</button></div></div>";
    }
    list.innerHTML = html;
}

function renderAdminVerification() {
    var list = document.getElementById("admin-verification-list");
    if (!list) return;
    var unverified = registeredProviders.filter(function(p) { return !p.verified; });
    if (unverified.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-shield text-4xl mb-3\"></i><p>All providers are verified.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < unverified.length; i++) {
        var p = unverified[i];
        var displayName = p.business_name || p.businessName || p.name;
        html += "<div class=\"bg-white rounded-2xl p-5 shadow\"><div class=\"flex justify-between items-start\"><div><p class=\"font-semibold\">" + displayName + "</p><p class=\"text-sm text-gray-500\">" + (p.email || "") + " \u2022 " + (p.phone || "") + "</p><p class=\"text-sm text-gray-500\">Service: " + (p.service || "General") + " \u2022 " + (p.location || "") + "</p>" + (p.bio ? "<p class=\"text-xs text-gray-400 mt-1\">" + p.bio + "</p>" : "") + "</div><div class=\"flex gap-2\"><button onclick=\"verifyProvider(" + p.id + ")\" class=\"bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-check\"></i> Verify</button><button onclick=\"rejectProvider(" + p.id + ")\" class=\"bg-red-500 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-times\"></i> Reject</button></div></div></div>";
    }
    list.innerHTML = html;
}

async function verifyProvider(id) {
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    var headers = { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" };
    try {
        var resp = await fetch(apiUrl + "/admin/providers/verify/" + id, { method: "POST", headers: headers });
        if (!resp.ok) { addInAppAlert("error", "Failed to verify provider on server"); return; }
        for (var i = 0; i < registeredProviders.length; i++) {
            if (registeredProviders[i].id === id) {
                registeredProviders[i].verified = true;
                var pname = registeredProviders[i].name;
                addNotification("\u2705", "Provider Verified", pname + " has been verified by admin.");
                addInAppAlert("success", pname + " has been verified! They will be notified to pay the joining fee.");
                break;
            }
        }
        renderAdminDashboard();
        renderAllProviderLists();
        saveAppState();
    } catch(e) { addInAppAlert("error", "Network error verifying provider"); }
}

async function rejectProvider(id) {
    showAppConfirm("Reject this provider application?", async function(confirmed) {
        if (!confirmed) return;
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        var headers = { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" };
        try {
            var resp = await fetch(apiUrl + "/admin/providers/reject/" + id, { method: "POST", headers: headers });
            if (!resp.ok) { addInAppAlert("error", "Failed to reject provider on server"); return; }
            var name = "";
            for (var i = 0; i < registeredProviders.length; i++) {
                if (registeredProviders[i].id === id) { name = registeredProviders[i].name; registeredProviders.splice(i, 1); break; }
            }
            addNotification("\u274C", "Provider Rejected", name + "'s application has been rejected.");
            addInAppAlert("info", name + "'s application has been rejected.");
            renderAdminDashboard();
            saveAppState();
        } catch(e) { addInAppAlert("error", "Network error rejecting provider"); }
    });
}

async function adminDeleteProvider(id) {
    showAppConfirm("Are you sure you want to permanently delete this provider account?", async function(confirmed) {
        if (!confirmed) return;
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        var headers = { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" };
        try {
            var resp = await fetch(apiUrl + "/admin/providers/" + id, { method: "DELETE", headers: headers });
            if (!resp.ok) { addInAppAlert("error", "Failed to delete provider on server"); return; }
            var name = "";
            for (var i = 0; i < registeredProviders.length; i++) {
                if (registeredProviders[i].id === id) { name = registeredProviders[i].name; registeredProviders.splice(i, 1); break; }
            }
            addNotification("\uD83D\uDDD1\uFE0F", "Provider Deleted", name + " has been deleted by admin.");
            addInAppAlert("info", name + " has been deleted.");
            renderAdminDashboard();
            saveAppState();
        } catch(e) { addInAppAlert("error", "Network error deleting provider"); }
    });
}

function renderAdminPriceRequests() {
    var list = document.getElementById("admin-price-requests-list");
    if (!list) return;
    if (priceChangeRequests.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-file-invoice text-4xl mb-3\"></i><p>No price change requests.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < priceChangeRequests.length; i++) {
        var r = priceChangeRequests[i];
        var statusBadge = r.status === "pending" ? "<span class=\"text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full\">Pending</span>" : r.status === "approved" ? "<span class=\"text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full\">Approved</span>" : "<span class=\"text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full\">" + r.status + "</span>";
        html += "<div id=\"price-req-" + r.id + "\" class=\"bg-white rounded-2xl p-5 shadow\"><div class=\"flex justify-between items-start\"><div><p class=\"font-semibold\">" + r.serviceName + "</p><p class=\"text-sm text-gray-500\">Provider: " + r.providerName + "</p><p class=\"text-sm\">Current: UGX " + r.currentPrice.toLocaleString() + " \u2192 Requested: UGX " + r.requestedPrice.toLocaleString() + "</p><p class=\"text-xs text-gray-400\">" + r.date + "</p></div><div>" + statusBadge + "</div></div>" + (r.status === "pending" ? "<div class=\"flex gap-2 mt-3\"><button onclick=\"approvePriceRequest(" + r.id + ")\" class=\"bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-check\"></i> Approve</button><button onclick=\"rejectPriceRequest(" + r.id + ")\" class=\"bg-red-500 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-times\"></i> Reject</button><button onclick=\"adjustPriceRequest(" + r.id + ")\" class=\"bg-blue-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-sliders\"></i> Adjust</button></div>" : "") + "</div>";
    }
    list.innerHTML = html;
}

function approvePriceRequest(id) {
    for (var i = 0; i < priceChangeRequests.length; i++) {
        if (priceChangeRequests[i].id === id) {
            priceChangeRequests[i].status = "approved";
            var req = priceChangeRequests[i];
            for (var j = 0; j < services.length; j++) {
                if (services[j].id === req.serviceId) {
                    services[j].basePrice = req.requestedPrice;
                    break;
                }
            }
            addNotification("\u2705", "Price Approved", req.providerName + "'s price change for " + req.serviceName + " to UGX " + req.requestedPrice.toLocaleString() + " has been approved.");
            break;
        }
    }
    renderAdminDashboard();
    renderAllProviderLists();
}

function rejectPriceRequest(id) {
    for (var i = 0; i < priceChangeRequests.length; i++) {
        if (priceChangeRequests[i].id === id) {
            priceChangeRequests[i].status = "rejected";
            addNotification("\u274C", "Price Rejected", "Price change for " + priceChangeRequests[i].serviceName + " has been rejected.");
            break;
        }
    }
    renderAdminDashboard();
}

function adjustPriceRequest(id) {
    showAppPrompt("Enter adjusted price (UGX):", "", function(newPrice) {
        if (!newPrice) return;
        newPrice = parseInt(newPrice);
        if (!newPrice || newPrice < 10000) { addInAppAlert("error", "Invalid price"); return; }
        for (var i = 0; i < priceChangeRequests.length; i++) {
            if (priceChangeRequests[i].id === id) {
                priceChangeRequests[i].status = "approved";
                priceChangeRequests[i].requestedPrice = newPrice;
                var req = priceChangeRequests[i];
                for (var j = 0; j < services.length; j++) {
                    if (services[j].id === req.serviceId) {
                        services[j].basePrice = newPrice;
                        break;
                    }
                }
                addNotification("\u2705", "Price Adjusted", req.providerName + "'s price for " + req.serviceName + " adjusted to UGX " + newPrice.toLocaleString());
                break;
            }
        }
        renderAdminDashboard();
        renderAllProviderLists();
    });
}

var adminReassigningTaskId = null;

function renderAdminOrders() {
    var list = document.getElementById("admin-orders-list");
    if (!list) return;
    if (adminTasks.length === 0) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-list-check text-4xl mb-3\"></i><p>No active orders. Completed and cancelled orders are automatically removed.</p></div>";
        return;
    }
    var html = "";
    for (var oi = 0; oi < adminTasks.length; oi++) {
        var t = adminTasks[oi];
        var provList = "";
        for (var pi = 0; pi < registeredProviders.length; pi++) {
            var provName = registeredProviders[pi].businessName || registeredProviders[pi].name;
            provList += "<option value=\"" + provName.replace(/'/g,"&#39;") + "\">" + provName + "</option>";
        }
        html += "<div class=\"bg-white rounded-2xl p-5 shadow border-l-4 " + (t.status === "pending_confirmation" ? "border-amber-500" : "border-green-500") + "\">" +
            "<div class=\"flex justify-between items-start\"><div><p class=\"font-semibold\">" + t.serviceName + "</p>" +
            "<p class=\"text-sm text-gray-500\">Order #" + t.id + "</p>" +
            "<p class=\"text-sm\"><strong>Customer:</strong> " + (t.customerName || "N/A") + "</p>" +
            "<p class=\"text-sm\"><strong>Provider:</strong> " + (t.providerName || "Unassigned") + "</p>" +
            "<p class=\"text-sm\"><strong>Address:</strong> " + (t.address || "N/A") + "</p>" +
            "<p class=\"text-sm\"><strong>Price:</strong> UGX " + (t.price || 0).toLocaleString() + "</p>" +
            "<p class=\"text-sm\"><strong>Status:</strong> " + t.status + "</p>" +
            "<p class=\"text-xs text-gray-400\">Created: " + (t.createdAt || "N/A") + "</p></div>" +
            "<div><span class=\"bg-" + (t.status === "pending_confirmation" ? "amber" : "green") + "-100 text-" + (t.status === "pending_confirmation" ? "amber" : "green") + "-700 px-3 py-1 rounded-full text-xs font-medium\">" + t.status + "</span></div></div>" +
            "<div class=\"mt-4 pt-4 border-t flex gap-3 flex-wrap items-center\">" +
            "<select id=\"admin-reassign-select-" + t.id + "\" class=\"border rounded-xl px-3 py-2 text-sm\"><option value=\"\">Select provider...</option>" + provList + "</select>" +
            "<button onclick=\"adminReassignTask(" + t.id + ")\" class=\"bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-arrow-right\"></i> Assign</button>" +
            "<button onclick=\"openAdminTaskChat(" + t.id + ",'" + (t.customerName || 'Customer').replace(/'/g,"\\'") + "')\" class=\"bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-comment\"></i> Chat</button>" +
            "</div></div>";
    }
    list.innerHTML = html;
}

async function adminReassignTask(taskId) {
    var select = document.getElementById("admin-reassign-select-" + taskId);
    if (!select) return;
    var providerName = select.value;
    if (!providerName) { addInAppAlert("error", "Please select a provider"); return; }
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    if (window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(apiUrl + "/admin/tasks/reassign/" + taskId, {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                body: JSON.stringify({ providerName: providerName })
            });
            var data = await resp.json();
            if (data.success) {
                addInAppAlert("success", "Order #" + taskId + " assigned to " + providerName);
                // Update local adminTasks
                for (var i = 0; i < adminTasks.length; i++) {
                    if (adminTasks[i].id === taskId) {
                        adminTasks[i].providerName = providerName;
                        adminTasks[i].status = "pending_confirmation";
                        break;
                    }
                }
                renderAdminOrders();
                return;
            }
            if (data.error) { addInAppAlert("error", data.error); return; }
        } catch(e) { addInAppAlert("error", "Network error reassigning task"); return; }
    }
    addInAppAlert("error", "You must be logged in as admin");
}

function openAdminTaskChat(taskId, customerName) {
    showAppPrompt("Enter your message for the customer:", "", function(msg) {
        if (!msg || !msg.trim()) return;
        var chatKey = taskId.toString();
        if (!chatConversations[chatKey]) chatConversations[chatKey] = [];
        chatConversations[chatKey].push({ id: Date.now(), text: msg.trim(), sender: "admin", time: Date.now() });
        addNotification("\uD83D\uDCAC", "Admin Message", "You sent a message regarding order #" + taskId);
        saveAppState();
        addInAppAlert("success", "Message sent regarding order #" + taskId);
    });
}

function renderAdminRevenue() {
    var list = document.getElementById("admin-revenue-list");
    if (!list) return;
    var totalRev = 0;
    var revData = completedTasks;
    if (adminRevenueData && adminRevenueData.revenue !== undefined) {
        totalRev = adminRevenueData.revenue;
        revData = adminRevenueData.byProvider || [];
    }
    if (revData.length === 0 && (!adminRevenueData || !adminRevenueData.byProvider)) {
        list.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-coins text-4xl mb-3\"></i><p>No revenue yet.</p></div>";
    } else {
        var html = "<div class=\"bg-white rounded-2xl p-6 shadow mb-6\"><h3 class=\"text-xl font-bold mb-2\">Total System Revenue (15%)</h3><p class=\"text-4xl font-bold text-emerald-600\">" + totalRev.toLocaleString() + " UGX</p></div><div class=\"space-y-4\">";
        if (adminRevenueData && adminRevenueData.byProvider) {
            for (var bi = 0; bi < adminRevenueData.byProvider.length; bi++) {
                var bp = adminRevenueData.byProvider[bi];
                html += "<div class=\"bg-white rounded-2xl p-4 shadow flex justify-between items-center\"><div><p class=\"font-medium\">" + bp.provider_name + "</p><p class=\"text-xs text-gray-500\">" + bp.jobs + " jobs completed</p></div><p class=\"font-bold text-amber-600\">+UGX " + Math.round(bp.revenue).toLocaleString() + "</p></div>";
            }
        } else {
            for (var i = 0; i < completedTasks.length; i++) {
                var t = completedTasks[i];
                var fee = Math.round(t.price * 0.15);
                html += "<div class=\"bg-white rounded-2xl p-4 shadow flex justify-between items-center\"><div><p class=\"font-medium\">" + (t.serviceName || "Service") + "</p><p class=\"text-xs text-gray-500\">" + (t.customerName || t.customer_email || "Customer") + " \u2022 " + (t.date || "") + "</p></div><p class=\"font-bold text-amber-600\">+UGX " + fee.toLocaleString() + "</p></div>";
            }
        }
        html += "</div>";
        list.innerHTML = html;
    }
}

function renderAdminChat() {
    var list = document.getElementById("admin-chat-list");
    if (!list) return;
    var html = "";
    // Customer support chats from chatConversations
    var customerChatKeys = [];
    for (var key in chatConversations) {
        if (key.indexOf("customer-admin-") === 0 && customerChatKeys.indexOf(key) === -1) customerChatKeys.push(key);
    }
    if (customerChatKeys.length > 0) {
        html += "<h4 class=\"font-semibold mb-3 text-blue-700\">Customer Support</h4>";
        for (var ck = 0; ck < customerChatKeys.length; ck++) {
            var chatKey = customerChatKeys[ck];
            var customerEmail = chatKey.replace("customer-admin-", "");
            var lastMsg = chatConversations[chatKey][chatConversations[chatKey].length - 1] || {};
            html += "<div class=\"bg-white rounded-2xl p-4 shadow flex justify-between items-center mb-2 border-l-4 border-blue-600\"><div><p class=\"font-semibold\">Customer: " + customerEmail + "</p><p class=\"text-xs text-gray-500\">" + (lastMsg.text ? lastMsg.text.substring(0, 40) : "No messages") + "</p></div><button onclick=\"openAdminCustomerChat('" + chatKey + "')\" class=\"bg-blue-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-comment\"></i> Reply</button></div>";
        }
    }
    // Provider chats from chatConversations
    var providerChatKeys = [];
    for (var key in chatConversations) {
        if ((key.indexOf("provider-admin-") === 0 || key.indexOf("admin-") === 0) && providerChatKeys.indexOf(key) === -1) providerChatKeys.push(key);
    }
    if (providerChatKeys.length > 0) {
        html += "<h4 class=\"font-semibold mb-3 mt-4 text-emerald-700\">Provider Support</h4>";
        for (var pk = 0; pk < providerChatKeys.length; pk++) {
            var chatKey = providerChatKeys[pk];
            var providerEmail = chatKey.replace("provider-admin-", "").replace("admin-", "");
            var lastMsg = chatConversations[chatKey][chatConversations[chatKey].length - 1] || {};
            html += "<div class=\"bg-white rounded-2xl p-4 shadow flex justify-between items-center mb-2 border-l-4 border-emerald-600\"><div><p class=\"font-semibold\">Provider: " + providerEmail + "</p><p class=\"text-xs text-gray-500\">" + (lastMsg.text ? lastMsg.text.substring(0, 40) : "No messages") + "</p></div><button onclick=\"openAdminProviderChat('" + providerEmail + "','" + providerEmail + "')\" class=\"bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-comment\"></i> Reply</button></div>";
        }
    }
    // Per-provider chat buttons
    if (registeredProviders.length > 0) {
        html += "<h4 class=\"font-semibold mb-3 mt-4 text-amber-700\">Chat with Providers</h4>";
        for (var pi = 0; pi < registeredProviders.length; pi++) {
            var p = registeredProviders[pi];
            var provEmail = p.email || (p.id + "") || p.name;
            html += "<div class=\"bg-white rounded-2xl p-4 shadow flex justify-between items-center mb-2 border-l-4 border-amber-600\"><div><p class=\"font-semibold\">" + p.name + "</p><p class=\"text-xs text-gray-500\">" + (p.service || "Provider") + " \u2022 " + (p.location || "") + "</p></div><button onclick=\"openAdminProviderChat('" + provEmail + "','" + p.name.replace(/'/g,"\\'") + "')\" class=\"bg-amber-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-comment\"></i> Chat</button></div>";
        }
    }
    // Task conversations
    var allTaskIds = [];
    for (var i = 0; i < providerTasks.length; i++) {
        if (allTaskIds.indexOf(providerTasks[i].id) === -1) allTaskIds.push(providerTasks[i].id);
    }
    for (var i = 0; i < completedTasks.length; i++) {
        if (allTaskIds.indexOf(completedTasks[i].id) === -1) allTaskIds.push(completedTasks[i].id);
    }
    if (allTaskIds.length > 0) {
        html += "<h4 class=\"font-semibold mb-3 mt-6 text-gray-700\">Task Conversations</h4>";
        for (var i = 0; i < allTaskIds.length; i++) {
            var taskId = allTaskIds[i];
            var task = null;
            for (var j = 0; j < providerTasks.length; j++) {
                if (providerTasks[j].id === taskId) { task = providerTasks[j]; break; }
            }
            if (!task) { for (var j = 0; j < completedTasks.length; j++) { if (completedTasks[j].id === taskId) { task = completedTasks[j]; break; } } }
            if (!task) continue;
            html += "<div class=\"bg-white rounded-2xl p-4 shadow flex justify-between items-center\"><div><p class=\"font-semibold\">" + (task.serviceName || "Task") + "</p><p class=\"text-xs text-gray-500\">" + (task.customerName || "Customer") + " \u2022 " + (task.providerName || "Provider") + "</p></div><button onclick=\"openAdminChat(" + taskId + ")\" class=\"bg-amber-600 text-white px-4 py-2 rounded-xl text-sm\"><i class=\"fa-solid fa-comment\"></i> Chat</button></div>";
        }
    }
    if (html === "") {
        html = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-comments text-4xl mb-3\"></i><p>No conversations yet.</p></div>";
    }
    list.innerHTML = html;
}

function openAdminCustomerChat(chatKey) {
    currentChatTaskId = chatKey;
    if (!chatConversations[chatKey]) chatConversations[chatKey] = [];
    loadChatFromStorage(chatKey);
    document.getElementById("chat-provider-name").textContent = "Customer Support - " + chatKey.replace("customer-admin-", "");
    document.getElementById("chat-provider-avatar").textContent = "\uD83D\uDCAC";
    renderChatMessages(chatConversations[chatKey], "admin");
    document.getElementById("chat-modal").classList.remove("hidden");
    startChatPolling(chatKey);
}

function openCustomerAdminChat() {
    if (!currentUser) { addInAppAlert("info", "Please login first to chat with admin"); showAuthModal("login"); return; }
    var chatId = "customer-admin-" + (currentUser.email || currentUser.phone || "guest");
    currentChatTaskId = chatId;
    if (!chatConversations[chatId]) chatConversations[chatId] = [];
    loadChatFromStorage(chatId).then(function() { renderCustomerAdminMessages(); }).catch(function() { renderCustomerAdminMessages(); });
    var area = document.getElementById("customer-admin-chat-area");
    if (area) area.classList.remove("hidden");
    renderCustomerAdminMessages();
}

async function sendCustomerAdminMessage() {
    var input = document.getElementById("customer-admin-chat-input");
    var text = sanitizeInput(input ? input.value.trim() : "");
    if (!text || !currentUser) return;
    var chatId = "customer-admin-" + (currentUser.email || currentUser.phone || "guest");
    if (!chatConversations[chatId]) chatConversations[chatId] = [];
    chatConversations[chatId].push({ text: text, sender: "customer", time: Date.now() });
    syncChatToStorage(chatId);

    // Send to backend
    var jwt = window.__HAVENGO_JWT__;
    if (jwt) {
        try {
            await fetch(HAVENGO_BACKEND_URL + "/api/chat/send", {
                method: "POST",
                headers: { "Authorization": "Bearer " + jwt, "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: chatId, message: text, sender: "Customer" })
            });
        } catch(e) { console.warn(e); }
    }

    renderCustomerAdminMessages();
    if (input) input.value = "";
    addNotification("\uD83D\uDCAC", "Customer Message", currentUser.name + " sent a message to admin support");
}

function renderCustomerAdminMessages() {
    var container = document.getElementById("customer-admin-messages");
    if (!container) return;
    var chatId = "customer-admin-" + (currentUser.email || currentUser.phone || "guest");
    var msgs = chatConversations[chatId] || [];
    if (msgs.length === 0) {
        container.innerHTML = "<div class=\"text-center text-gray-400 py-6\"><i class=\"fa-solid fa-comments text-3xl mb-2\"></i><p class=\"text-sm\">Start a conversation with admin support.</p></div>";
        return;
    }
    var html = "";
    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        var isSent = m.sender === "customer";
        var msgId = m.id || ("cadm_" + i + "_" + m.time);
        html += "<div class=\"flex " + (isSent ? "justify-end" : "justify-start") + "\"><div class=\"" + (isSent ? "bg-emerald-600 text-white" : "bg-gray-100") + " rounded-2xl px-4 py-3 max-w-xs relative group\"><button onclick=\"deleteChatMessage('" + chatId + "','" + msgId + "'," + i + ")\" class=\"absolute -top-2 -right-2 text-xs text-red-400 hover:text-red-600 bg-white rounded-full w-5 h-5 flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity\" title=\"Delete\"><i class=\"fa-solid fa-times\"></i></button><p class=\"text-sm\">" + m.text + "</p><p class=\"text-xs mt-1 " + (isSent ? "text-emerald-100" : "text-gray-400") + "\">" + new Date(m.time).toLocaleTimeString() + "</p></div></div>";
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// Customer admin chat polling (fetch from backend)
setInterval(function() {
    if (currentUser && !document.getElementById("customer-admin-chat-area").classList.contains("hidden")) {
        var chatId = "customer-admin-" + (currentUser.email || currentUser.phone || "guest");
        loadChatFromStorage(chatId);
    }
}, 10000);

function showTrackingInfo(bookingId) {
    var nameEl = document.getElementById("tracking-provider-name");
    var serviceEl = document.getElementById("tracking-service-name");
    var etaEl = document.getElementById("tracking-eta-value");
    var contactEl = document.getElementById("tracking-provider-contact");
    if (nameEl) nameEl.textContent = "Provider Assigned";
    if (contactEl) contactEl.textContent = "";
    if (serviceEl && currentLoggedProvider) serviceEl.textContent = currentLoggedProvider.service || currentLoggedProvider.name || "Service";
    if (etaEl) etaEl.textContent = "12 min";
    if (bookingId) {
        var foundBooking = null;
        for (var i = 0; i < bookings.length; i++) {
            if (bookings[i].id === bookingId) { foundBooking = bookings[i]; break; }
        }
        // Find provider who completed this task
        var providerName = null;
        var providerPhone = null;
        for (var i = 0; i < providerTasks.length; i++) {
            if (providerTasks[i].id === bookingId) {
                providerName = providerTasks[i].providerName || providerTasks[i].customerName;
                break;
            }
        }
        if (!providerName) {
            for (var i = 0; i < completedTasks.length; i++) {
                if (completedTasks[i].id === bookingId) {
                    providerName = completedTasks[i].providerName || completedTasks[i].customerName;
                    providerPhone = completedTasks[i].customerPhone;
                    break;
                }
            }
        }
        if (nameEl) nameEl.textContent = providerName || "Provider Assigned";
        if (contactEl && providerPhone) contactEl.textContent = "\uD83D\uDCDE " + providerPhone;
        if (serviceEl && foundBooking) serviceEl.textContent = foundBooking.serviceName || "Service";
    }
    document.getElementById("tracking-modal").classList.remove("hidden");
}

function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add("hidden");
}

// ============================================================
// CUSTOMER WITHDRAW
// ============================================================

var paymentDeclineTime = null;
var autoPaymentTimer = null;

function checkAutoPayments() {
    var now = Date.now();
    for (var i = 0; i < pendingPayments.length; i++) {
        var p = pendingPayments[i];
        if (!p.paid && p.deadline && p.deadline <= now) {
            if (userBalance >= p.amount) {
                userBalance -= p.amount;
                p.paid = true;
                addNotification('💰', 'Auto-Payment Deducted', 'UGX ' + p.amount.toLocaleString() + ' deducted for ' + p.taskName + '. Provider has been credited.');
                addInAppAlert('info', 'Payment of UGX ' + p.amount.toLocaleString() + ' for ' + p.taskName + ' auto-deducted (10hr deadline reached).');
            } else {
                p.overdue = true;
                addNotification('⚠️', 'Payment Overdue', 'Payment for ' + p.taskName + ' is overdue. Please deposit funds.');
                addInAppAlert('warning', 'Payment for ' + p.taskName + ' is overdue. Please deposit UGX ' + p.amount.toLocaleString() + ' to avoid penalties.');
            }
        }
    }
    renderBookings();
    renderProfilePage();
    saveAppState();
}

async function fetchPendingPayments() {
    if (!window.__HAVENGO_JWT__ || !currentUser) return;
    try {
        var resp = await fetch(HAVENGO_BACKEND_URL + "/api/customer/pending-payments", {
            headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__ }
        });
        if (resp.ok) {
            var backendPps = await resp.json();
            for (var bpi = 0; bpi < backendPps.length; bpi++) {
                var bp = backendPps[bpi];
                var exists = pendingPayments.some(function(pp) { return pp.taskId === bp.task_id; });
                if (!exists) {
                    var taskName = "";
                    for (var ci = 0; ci < completedTasks.length; ci++) {
                        if (completedTasks[ci].taskId === bp.task_id || completedTasks[ci].id === bp.task_id) {
                            taskName = completedTasks[ci].serviceName; break;
                        }
                    }
                    if (!taskName) {
                        for (var bi = 0; bi < bookings.length; bi++) {
                            if (bookings[bi].id === bp.task_id) { taskName = bookings[bi].serviceName; break; }
                        }
                    }
                    pendingPayments.push({
                        id: Date.now() + bpi,
                        taskId: bp.task_id,
                        taskName: taskName,
                        amount: bp.amount,
                        providerName: bp.provider_name,
                        customerName: "",
                        completedAt: new Date(bp.completed_at).getTime(),
                        deadline: new Date(bp.completed_at).getTime() + 36000000,
                        paid: false
                    });
                }
            }
            renderBookings();
            renderProfilePage();
            saveAppState();
        }
    } catch(e) { console.warn(e); }
}

function startAutoPaymentCheck() {
    if (autoPaymentTimer) clearInterval(autoPaymentTimer);
    autoPaymentTimer = setInterval(checkAutoPayments, 60000); // Check every minute
    checkAutoPayments();
}

function hasPendingPayment() {
    for (var i = 0; i < pendingPayments.length; i++) {
        if (!pendingPayments[i].paid) return true;
    }
    return false;
}

function getNearestPaymentDeadline() {
    var now = Date.now();
    var nearest = null;
    for (var i = 0; i < pendingPayments.length; i++) {
        var p = pendingPayments[i];
        if (!p.paid && p.deadline && p.deadline > now) {
            if (nearest === null || p.deadline < nearest) nearest = p.deadline;
        }
    }
    return nearest;
}

function hasActiveOrder() {
    for (var i = 0; i < bookings.length; i++) {
        if (bookings[i].status === "In Progress") return true;
    }
    return false;
}

function showCustomerWithdrawModal() {
    if (!currentUser) { addInAppAlert("info", "Please login first"); showAuthModal("login"); return; }
    // Check for active orders
    if (hasActiveOrder()) {
        addInAppAlert("warning", "Cannot withdraw while you have an active order in progress.");
        return;
    }
    document.getElementById("customer-withdraw-balance").textContent = userBalance.toLocaleString() + " UGX";
    document.getElementById("customer-withdraw-amount").value = "";
    document.getElementById("customer-withdraw-fee").textContent = "0 UGX";
    document.getElementById("customer-withdraw-receive").textContent = "0 UGX";
    
    var blocked = hasPendingPayment();
    document.getElementById("withdraw-blocked-msg").classList.toggle("hidden", !blocked);
    document.getElementById("customer-withdraw-btn").disabled = blocked || hasActiveOrder();
    document.getElementById("customer-withdraw-btn").className = blocked ? "w-full bg-gray-400 text-white py-4 rounded-3xl font-semibold cursor-not-allowed" : "w-full bg-amber-600 hover:bg-amber-700 text-white py-4 rounded-3xl font-semibold";
    
    document.getElementById("customer-withdraw-modal").classList.remove("hidden");
}

function updateCustomerWithdrawFee() {
    var amount = parseInt(document.getElementById("customer-withdraw-amount").value) || 0;
    var fee = Math.round(amount * 0.005);
    var receive = amount - fee;
    document.getElementById("customer-withdraw-fee").textContent = fee.toLocaleString() + " UGX";
    document.getElementById("customer-withdraw-receive").textContent = receive.toLocaleString() + " UGX";
}

async function processCustomerWithdraw() {
    var amount = parseInt(document.getElementById("customer-withdraw-amount").value) || 0;
    var phone = document.getElementById("customer-withdraw-phone").value.trim();
    
    if (hasPendingPayment()) { addInAppAlert("error", "You have a pending payment. Please settle it before withdrawing."); return; }
    if (hasActiveOrder()) { addInAppAlert("error", "Cannot withdraw while you have an active order in progress."); return; }
    if (amount < 1000) { addInAppAlert("error", "Minimum withdrawal is 1,000 UGX"); return; }
    if (amount > userBalance) { addInAppAlert("error", "Insufficient balance."); return; }
    if (!phone || phone.length < 8) { addInAppAlert("error", "Enter a valid Mobile Money number"); return; }
    
    // Try backend first
    if (window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(HAVENGO_BACKEND_URL + "/api/customer/withdraw", {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                body: JSON.stringify({ amount: amount })
            });
            var data = await resp.json();
            if (data.success) {
                var fee = Math.round(amount * 0.005);
                var netAmount = amount - fee;
                userBalance -= amount;
                closeModal("customer-withdraw-modal");
                renderProfilePage();
                addNotification("\uD83C\uDFE7", "Withdrawal Initiated", "UGX " + netAmount.toLocaleString() + " sent to " + phone);
                addInAppAlert("success", "Withdrawal of UGX " + netAmount.toLocaleString() + " initiated to " + phone);
                saveAppState();
                return;
            }
            if (data.error) { addInAppAlert("error", data.error); return; }
        } catch(e) { console.warn(e); }
    }
    
    var fee = Math.round(amount * 0.005);
    var netAmount = amount - fee;
    userBalance -= amount;
    closeModal("customer-withdraw-modal");
    renderProfilePage();
    addNotification("\uD83C\uDFE7", "Withdrawal Initiated", "UGX " + netAmount.toLocaleString() + " sent to " + phone);
    addInAppAlert("success", "Withdrawal of UGX " + netAmount.toLocaleString() + " initiated to " + phone);
    saveAppState();
}

// Provider withdraw functions
function showWithdrawModal() {
    if (!currentLoggedProvider) return;
    var available = providerEarningsMap[currentLoggedProvider.name] || 0;
    document.getElementById("withdraw-available-balance").textContent = available.toLocaleString() + " UGX";
    document.getElementById("withdraw-amount").value = Math.min(available, 50000);
    document.getElementById("withdraw-fee").textContent = "0 UGX";
    document.getElementById("withdraw-receive").textContent = "0 UGX";
    document.getElementById("withdraw-phone").value = currentLoggedProvider.phone || "";
    document.getElementById("withdraw-modal").classList.remove("hidden");
}

function updateWithdrawFee() {
    var amount = parseInt(document.getElementById("withdraw-amount").value) || 0;
    var fee = Math.round(amount * 0.005);
    var receive = amount - fee;
    document.getElementById("withdraw-fee").textContent = fee.toLocaleString() + " UGX";
    document.getElementById("withdraw-receive").textContent = receive.toLocaleString() + " UGX";
}

async function processWithdraw() {
    var amount = parseInt(document.getElementById("withdraw-amount").value) || 0;
    var phone = document.getElementById("withdraw-phone").value.trim();
    var available = providerEarningsMap[currentLoggedProvider.name] || 0;

    if (amount < 1000) { addInAppAlert("error", "Minimum withdrawal is 1,000 UGX"); return; }
    if (amount > available) { addInAppAlert("error", "Insufficient earnings."); return; }
    if (!phone || phone.length < 8) { addInAppAlert("error", "Enter a valid Mobile Money number"); return; }

    // Try backend first
    if (window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(HAVENGO_BACKEND_URL + "/api/provider/withdraw", {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                body: JSON.stringify({ amount: amount })
            });
            var data = await resp.json();
            if (!data.success) { addInAppAlert("error", data.error || "Withdrawal failed"); return; }
        } catch(e) { /* fall through to local */ }
    }

    var fee = Math.round(amount * 0.005);
    var netAmount = amount - fee;
    if (!providerEarningsMap[currentLoggedProvider.name]) providerEarningsMap[currentLoggedProvider.name] = 0;
    providerEarningsMap[currentLoggedProvider.name] -= amount + fee;
    closeModal("withdraw-modal");
    renderProviderDashboard();
    addNotification("\uD83C\uDFE7", "Withdrawal Initiated", "UGX " + netAmount.toLocaleString() + " sent to " + phone);
    addInAppAlert("success", "Withdrawal of UGX " + netAmount.toLocaleString() + " initiated to " + phone);
}

// Track payment declines for 2-minute notification
function trackPaymentDecline() {
    if (hasPendingPayment() && paymentDeclineTime === null) {
        var now = Date.now();
        paymentDeclineTime = now;
        setTimeout(function() {
            if (hasPendingPayment() && paymentDeclineTime !== null) {
                addNotification("\u26A0\uFE0F", "Withdrawals Blocked", "You cannot withdraw funds until the pending payment is completed. Auto-deduction in 10 hours.");
                paymentDeclineTime = null;
            }
        }, 120000);
    }
    if (!hasPendingPayment()) paymentDeclineTime = null;
}

// Update countdown in profile payments tab
function updatePaymentCountdown() {
    var deadline = getNearestPaymentDeadline();
    var el = document.getElementById("payment-countdown");
    var timerEl = document.getElementById("countdown-timer");
    if (!el || !timerEl) return;
    if (deadline === null || !hasPendingPayment()) {
        el.classList.add("hidden");
        return;
    }
    el.classList.remove("hidden");
    var remaining = deadline - Date.now();
    if (remaining <= 0) {
        timerEl.textContent = "Auto-deducting...";
        return;
    }
    var hours = Math.floor(remaining / 3600000);
    var mins = Math.floor((remaining % 3600000) / 60000);
    var secs = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = hours.toString().padStart(2,'0') + ":" + mins.toString().padStart(2,'0') + ":" + secs.toString().padStart(2,'0');
}

setInterval(updatePaymentCountdown, 1000);

function rateBooking(bookingId) {
    var booking = null;
    for (var i = 0; i < bookings.length; i++) {
        if (bookings[i].id === bookingId) { booking = bookings[i]; break; }
    }
    if (!booking) return;
    if (!currentUser) { addInAppAlert("info", "Please login to rate a provider"); showAuthModal("login"); return; }
    showAppPrompt("Rate this service (1-5 stars): " + booking.serviceName, "5", function(rating) {
        if (rating) {
            var numRating = parseInt(rating);
            if (numRating >= 1 && numRating <= 5) {
                userRatings.push({ providerName: booking.providerName || "Provider", rating: numRating, taskName: booking.serviceName });
                updateProviderUI();
                addNotification("\u2B50", "Rating Submitted", "You rated " + (booking.providerName || "Provider") + " " + numRating + " stars!");
                addInAppAlert("success", "Thank you! Your rating of " + numRating + " stars has been recorded.");
            } else {
                addInAppAlert("error", "Rating must be between 1 and 5.");
            }
        }
    });
}

// ============================================================
// 10-HOUR AUTO-PAYMENT SYSTEM
// ============================================================

// ============================================================
// CHAT FUNCTIONS - Shared conversations between customer & provider
// ============================================================

function findTask(taskId) {
    for (var i = 0; i < providerTasks.length; i++) {
        if (providerTasks[i].id === taskId) return providerTasks[i];
    }
    for (var i = 0; i < completedTasks.length; i++) {
        if (completedTasks[i].id === taskId) return completedTasks[i];
    }
    return null;
}

function renderChatMessages(messages, currentRole) {
    var container = document.getElementById("chat-messages");
    if (!container) return;
    if (!messages || messages.length === 0) {
        container.innerHTML = "<div class=\"text-center text-gray-500 py-8\"><i class=\"fa-solid fa-comments text-4xl mb-3\"></i><p>No messages yet. Start the conversation!</p></div>";
        container.scrollTop = 0;
        return;
    }
    var html = "";
    for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        var isSent = m.sender === currentRole;
        var bubbleClass = isSent ? "chat-bubble-sent ml-auto" : "chat-bubble-received";
        var timeClass = isSent ? "text-emerald-100" : "text-gray-400";
        var msgId = m.id || ("msg_" + i + "_" + m.time);
        html += "<div class=\"chat-bubble " + bubbleClass + "\" data-msg-id=\"" + msgId + "\">" +
            "<div class=\"flex items-start justify-between gap-2\">" +
            "<div>" + m.text + "</div>" +
            "<button onclick=\"deleteChatMessage('" + currentChatTaskId + "','" + msgId + "'," + i + ")\" class=\"text-xs text-red-400 hover:text-red-600 flex-shrink-0 ml-1\" title=\"Delete\"><i class=\"fa-solid fa-times\"></i></button>" +
            "</div>" +
            "<div class=\"text-xs mt-1 " + timeClass + "\">" + new Date(m.time).toLocaleTimeString() + "</div>" +
            "</div>";
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

async function deleteChatMessage(convId, msgId, index) {
    showAppConfirm("Delete this message?", async function(confirmed) {
        if (!confirmed) return;
        var jwt = window.__HAVENGO_JWT__;
    // Try backend deletion
    if (jwt && convId && msgId && !msgId.startsWith("msg_")) {
        try {
            var endpoint = currentAdmin ? "/admin/chat/" : "/chat/";
            await fetch(HAVENGO_BACKEND_URL + "/api" + endpoint + encodeURIComponent(convId) + "/message/" + msgId, {
                method: "DELETE", headers: { "Authorization": "Bearer " + jwt }
            });
        } catch(e) { console.warn(e); }
    }
    // Remove locally
    if (chatConversations[convId] && chatConversations[convId][index]) {
        chatConversations[convId].splice(index, 1);
        syncChatToStorage(convId);
        var currentRole = currentAdmin ? "admin" : (currentLoggedProvider ? "provider" : "customer");
        if (convId && (convId.indexOf("customer-admin") === 0 || convId.indexOf("provider-admin") === 0)) {
            renderCustomerAdminMessages();
        }
        if (document.getElementById("chat-messages")) {
            renderChatMessages(chatConversations[convId], currentRole);
        }
    }
    });
}

function openChatWithProvider(taskId) {
    currentChatTaskId = taskId;
    if (!chatConversations[taskId]) chatConversations[taskId] = [];
    loadChatFromStorage(taskId).then(function() { renderChatMessages(chatConversations[taskId], "customer"); }).catch(function(e){ console.warn("Chat load failed:", e); });
    var task = findTask(taskId);
    document.getElementById("chat-provider-name").textContent = (task ? task.serviceName : "Chat") + " \u2014 " + (task ? task.customerName : "Customer");
    document.getElementById("chat-provider-avatar").textContent = "\uD83D\uDCAC";
    renderChatMessages(chatConversations[taskId], "customer");
    document.getElementById("chat-modal").classList.remove("hidden");
    startChatPolling(taskId);
}

function openProviderChat(taskId) {
    currentChatTaskId = taskId;
    if (!chatConversations[taskId]) chatConversations[taskId] = [];
    loadChatFromStorage(taskId);
    var task = findTask(taskId);
    document.getElementById("chat-provider-name").textContent = task ? task.customerName : "Customer";
    document.getElementById("chat-provider-avatar").textContent = "\uD83D\uDC64";
    renderChatMessages(chatConversations[taskId], "provider");
    document.getElementById("chat-modal").classList.remove("hidden");
    startChatPolling(taskId);
}

function openProviderAdminChat() {
    var provEmail = currentLoggedProvider ? (currentLoggedProvider.email || currentLoggedProvider.name) : "unknown";
    var chatId = "provider-admin-" + provEmail;
    currentChatTaskId = chatId;
    if (!chatConversations[chatId]) chatConversations[chatId] = [];
    loadChatFromStorage(chatId).then(function() { renderChatMessages(chatConversations[chatId], "provider"); }).catch(function(e){ console.warn("Chat load failed:", e); });
    document.getElementById("chat-provider-name").textContent = "Admin Support";
    document.getElementById("chat-provider-avatar").textContent = "\uD83D\uDC6E";
    renderChatMessages(chatConversations[chatId], "provider");
    document.getElementById("chat-modal").classList.remove("hidden");
    startChatPolling(chatId);
}

function openAdminProviderChat(providerEmail, providerName) {
    var chatId = "provider-admin-" + providerEmail;
    currentChatTaskId = chatId;
    if (!chatConversations[chatId]) chatConversations[chatId] = [];
    loadChatFromStorage(chatId).then(function() { renderChatMessages(chatConversations[chatId], "admin"); }).catch(function(e){ console.warn("Chat load failed:", e); });
    document.getElementById("chat-provider-name").textContent = providerName || "Provider";
    document.getElementById("chat-provider-avatar").textContent = "\uD83D\uDCAC";
    renderChatMessages(chatConversations[chatId], "admin");
    document.getElementById("chat-modal").classList.remove("hidden");
    startChatPolling(chatId);
}

function closeChatModal() {
    stopChatPolling();
    document.getElementById("chat-modal").classList.add("hidden");
}

async function sendChatMessage() {
    var input = document.getElementById("chat-input");
    var text = sanitizeInput(input ? input.value.trim() : "");
    if (!text || !currentChatTaskId) return;

    if (!chatConversations[currentChatTaskId]) chatConversations[currentChatTaskId] = [];

    var currentRole = currentAdmin ? "admin" : (currentLoggedProvider ? "provider" : "customer");

    var msg = { text: text, sender: currentRole, time: Date.now() };

    chatConversations[currentChatTaskId].push(msg);
    syncChatToStorage(currentChatTaskId);

    // Send to backend for cross-browser sync
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    var jwt = window.__HAVENGO_JWT__;
    if (jwt) {
        var convId = currentChatTaskId;
        var chatSender = currentAdmin ? "Admin" : (currentLoggedProvider ? currentLoggedProvider.name : "Customer");
        try {
            var endpoint = currentAdmin ? "/admin/chat/send" : "/chat/send";
            await fetch(apiUrl + endpoint, {
                method: "POST",
                headers: { "Authorization": "Bearer " + jwt, "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: convId, message: text, sender: chatSender })
            });
        } catch(e) { console.warn(e); }
    }

    renderChatMessages(chatConversations[currentChatTaskId], currentRole);
    if (input) input.value = "";

    var notifTitle = currentRole === "customer" ? "New Message from Customer" : "New Message from Provider";
    addNotification("\uD83D\uDCAC", notifTitle, text);
}

function syncChatToStorage(taskId) {
    try {
        localStorage.setItem("havengo-chat-" + taskId, JSON.stringify(chatConversations[taskId] || []));
    } catch(e) { console.warn(e); }
}

async function loadChatFromStorage(taskId) {
    // Fetch from backend first (cross-browser sync)
    var jwt = window.__HAVENGO_JWT__;
    if (jwt && taskId) {
        var apiUrl = HAVENGO_BACKEND_URL + "/api";
        try {
            var endpoint = currentAdmin ? "/admin/chat/" : "/chat/";
            var resp = await fetch(apiUrl + endpoint + encodeURIComponent(taskId), {
                headers: { "Authorization": "Bearer " + jwt }
            });
            if (resp.ok) {
                var backendMsgs = await resp.json();
                if (backendMsgs.length > 0) {
                    // Build set of local (text+sender) to preserve unsent messages
                    var localOnly = [];
                    if (chatConversations[taskId]) {
                        var backendSet = {};
                        for (var bi = 0; bi < backendMsgs.length; bi++) {
                            var bm = backendMsgs[bi];
                            var backendSender = bm.sender === "Admin" ? "admin" : (bm.sender === "Customer" ? "customer" : bm.sender);
                            backendSet[bm.message + "_" + backendSender] = true;
                        }
                        for (var li = 0; li < chatConversations[taskId].length; li++) {
                            var lm = chatConversations[taskId][li];
                            if (!backendSet[lm.text + "_" + lm.sender]) {
                                localOnly.push(lm);
                            }
                        }
                    }
                    // Replace with backend messages + local-only messages, sorted by time
                    var combined = backendMsgs.map(function(bm) {
                        var sender = bm.sender === "Admin" ? "admin" : bm.sender;
                        if (currentUser && sender === currentUser.name) sender = "customer";
                        return { id: bm.id, text: bm.message, sender: sender, time: new Date(bm.created_at).getTime() };
                    }).concat(localOnly);
                    combined.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
                    var msgSnap = combined.length;
                    if (msgSnap !== window.__lastChatSnap) {
                        chatConversations[taskId] = combined;
                        checkNewChatMessages(taskId);
                        var currentRole = currentAdmin ? "admin" : (currentLoggedProvider ? "provider" : "customer");
                        renderChatMessages(chatConversations[taskId], currentRole);
                        window.__lastChatSnap = msgSnap;
                    }
                    return;
                }
            }
        } catch(e) { console.warn(e); }
    }

    // Fallback: localStorage
    try {
        var data = localStorage.getItem("havengo-chat-" + taskId);
        if (data) {
            var stored = JSON.parse(data);
            if (stored && stored.length > 0) {
                if (!chatConversations[taskId]) chatConversations[taskId] = [];
                var localLen = chatConversations[taskId].length;
                if (stored.length > localLen) {
                    var newMsgs = stored.slice(localLen);
                    for (var mi = 0; mi < newMsgs.length; mi++) {
                        chatConversations[taskId].push(newMsgs[mi]);
                    }
                    var currentRole = currentAdmin ? "admin" : (currentLoggedProvider ? "provider" : "customer");
                    renderChatMessages(chatConversations[taskId], currentRole);
                }
            }
        }
    } catch(e) { console.warn(e); }
}

var lastChatMessageMaxId = {};

function checkNewChatMessages(taskId) {
    var msgs = chatConversations[taskId];
    if (!msgs || msgs.length === 0) return;
    var maxId = 0;
    for (var mi = 0; mi < msgs.length; mi++) {
        if (msgs[mi].id && msgs[mi].id > maxId) maxId = msgs[mi].id;
    }
    var prevMaxId = lastChatMessageMaxId[taskId] || 0;
    if (maxId > prevMaxId && prevMaxId > 0) {
        var currentRoleSender = currentAdmin ? "admin" : (currentLoggedProvider ? (currentLoggedProvider.name || currentLoggedProvider.business_name || "provider") : "customer");
        for (var mi = 0; mi < msgs.length; mi++) {
            if (msgs[mi].id && msgs[mi].id > prevMaxId && msgs[mi].sender !== currentRoleSender) {
                addNotification("\uD83D\uDCAC", "New Message", msgs[mi].text.substring(0, 60));
                break;
            }
        }
    }
    lastChatMessageMaxId[taskId] = maxId;
}

var chatPollInterval = null;

function startChatPolling(taskId) {
    stopChatPolling();
    if (!taskId) return;
    chatPollInterval = setInterval(function() {
        if (document.getElementById("chat-modal").classList.contains("hidden")) {
            return;
        }
        loadChatFromStorage(taskId);
    }, 1500);
}

function stopChatPolling() {
    if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }
}

// ============================================================
// BLOG
// ============================================================

function renderBlogPosts() {
    var container = document.getElementById("blog-posts");
    if (!container) return;
    var html = "";
    for (var i = 0; i < blogPosts.length; i++) {
        var p = blogPosts[i];
        html += "<div onclick=\"showBlogPost(" + i + ")\" class=\"blog-post bg-white rounded-3xl shadow overflow-hidden cursor-pointer\">" +
            "<img src=\"" + p.image + "\" class=\"h-52 w-full object-cover\">" +
            "<div class=\"p-6\">" +
            "<p class=\"text-xs text-gray-500 mb-2\">" + p.date + "</p>" +
            "<h3 class=\"font-bold text-xl mb-2\">" + p.title + "</h3>" +
            "<p class=\"text-gray-600 text-sm\">" + p.content.substring(0, 100) + "...</p></div></div>";
    }
    container.innerHTML = html;
}

function showBlogPost(index) {
    var post = blogPosts[index];
    if (!post) return;
    document.getElementById("blog-modal-title").textContent = post.title;
    document.getElementById("blog-modal-date").textContent = post.date;
    document.getElementById("blog-modal-image").src = post.image;
    document.getElementById("blog-modal-content").innerHTML = "<p>" + post.content + "</p>";
    document.getElementById("blog-detail-modal").classList.remove("hidden");
}

function closeBlogModal() {
    document.getElementById("blog-detail-modal").classList.add("hidden");
}

// ============================================================
// PROVIDER APPLICATION
// ============================================================

function populateMultiServiceSelect() {
    var container = document.getElementById("multi-service-select");
    if (!container) return;
    var html = "";
    for (var i = 0; i < services.length; i++) {
        var s = services[i];
        html += "<option value=\"" + s.id + "\">" + (serviceEmojis[s.category] || "\uD83D\uDCCB") + " " + s.name + "</option>";
    }
    container.innerHTML = html;
}

function populateBitmojiSelect() {
    var container = document.getElementById("bitmoji-select");
    if (!container) return;
    if (selectedBitmoji) {
        container.textContent = selectedBitmoji;
        container.classList.remove("border-dashed", "border-gray-300");
        container.classList.add("border-2", "border-emerald-600", "bg-emerald-50");
    } else {
        container.textContent = "👤";
        container.classList.add("border-dashed", "border-gray-300");
        container.classList.remove("border-emerald-600", "bg-emerald-50");
    }
}
function toggleProviderBitmojiPicker() {
    var picker = document.getElementById("provider-bitmoji-picker");
    if (!picker) return;
    var grid = document.getElementById("provider-bitmoji-grid");
    if (!grid) return;
    if (!picker.classList.contains("hidden")) {
        picker.classList.add("hidden");
        return;
    }
    var html = "";
    for (var i = 0; i < bitmojiOptions.length; i++) {
        var b = bitmojiOptions[i];
        var activeClass = selectedBitmoji === b ? "bg-emerald-100 ring-2 ring-emerald-600" : "";
        html += "<div onclick=\"selectProviderBitmoji('" + b + "')\" class=\"cursor-pointer text-center p-1 rounded-xl hover:bg-emerald-50 " + activeClass + "\">" + b + "</div>";
    }
    grid.innerHTML = html;
    picker.classList.remove("hidden");
}
function selectProviderBitmoji(emoji) {
    selectedBitmoji = emoji;
    document.getElementById("provider-bitmoji-picker").classList.add("hidden");
    populateBitmojiSelect();
}

async function submitProviderApplication(event) {
    event.preventDefault();
    var name = sanitizeInput(document.getElementById("prov-name").value.trim());
    var phone = sanitizeInput(document.getElementById("prov-phone").value.trim());
    var email = sanitizeInput(document.getElementById("prov-email").value.trim());
    var businessName = sanitizeInput(document.getElementById("prov-business").value.trim());
    var exp = document.getElementById("prov-exp").value;
    var password = document.getElementById("prov-password").value;
    var confirmPassword = document.getElementById("prov-confirm-password").value;
    var location = sanitizeInput(document.getElementById("prov-location").value.trim());
    var bio = sanitizeInput(document.getElementById("prov-bio").value.trim());

    if (!name || !phone || !exp || !password || !location || !businessName) {
        addInAppAlert("error", "Please fill in all required fields");
        return;
    }
    if (password !== confirmPassword) {
        addInAppAlert("error", "Passwords do not match");
        return;
    }
    if (!/^0\d{9}$/.test(phone)) {
        addInAppAlert("error", "Please enter a valid 10-digit phone number starting with 0 (e.g. 0777123456)");
        return;
    }

    var select = document.getElementById("multi-service-select");
    var selectedOptions = [];
    for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].selected) {
            selectedOptions.push(select.options[i].value);
        }
    }
    if (selectedOptions.length === 0) {
        addInAppAlert("error", "Please select at least one service category");
        return;
    }
    if (!selectedBitmoji) {
        addInAppAlert("error", "Please select a bitmoji");
        return;
    }
    if (!document.getElementById("agree-terms").checked) {
        addInAppAlert("error", "Please agree to the terms");
        return;
    }

    // Show consent form before submission
    showProviderConsentForm({
        name: name, phone: phone, email: email, businessName: businessName,
        exp: exp, password: password, confirmPassword: confirmPassword,
        location: location, bio: bio, selectedOptions: selectedOptions
    });
}

function showProviderConsentForm(data) {
    var modal = document.getElementById("provider-consent-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "provider-consent-modal";
        modal.className = "hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 modal p-5";
        modal.innerHTML = '<div class="bg-white w-full max-w-lg rounded-3xl overflow-hidden max-h-[90vh] overflow-y-auto"><div class="hero-gradient text-white p-6"><h2 class="text-2xl font-bold">Provider Consent & Agreement</h2></div><div class="p-6 space-y-4"><div class="bg-amber-50 border border-amber-200 rounded-2xl p-4"><h3 class="font-semibold text-amber-800 mb-2"><i class="fa-solid fa-handshake"></i> Please read and accept the following:</h3><ul class="text-sm text-amber-700 space-y-2 list-disc list-inside"><li><strong>15% Service Fee:</strong> A 15% platform fee will be deducted from all payments received for services rendered through HavenGo.</li><li><strong>Joining Fee: 50,000 UGX</strong> A one-time registration fee of 50,000 UGX is required after admin verification to activate your account.</li><li><strong>Terms & Conditions:</strong> You agree to abide by HavenGo\'s terms of service, code of conduct, and quality standards.</li><li><strong>Diligent Service:</strong> You commit to serving customers diligently, professionally, and in a timely manner.</li><li><strong>Verification:</strong> Your application will be reviewed by admin. Once verified, you will be notified to pay the joining fee.</li></ul></div><div class="flex items-start gap-3 p-4 rounded-2xl bg-gray-50"><input type="checkbox" id="consent-agree" class="w-5 h-5 mt-1"><label for="consent-agree" class="text-sm text-gray-700">I have read and agree to all the terms above, including the 15% service fee and the 50,000 UGX joining fee.</label></div><div class="flex gap-3"><button id="consent-submit-btn" onclick="submitProviderWithConsent()" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-semibold"><i class="fa-solid fa-check"></i> Accept & Submit</button><button onclick="closeProviderConsent()" class="flex-1 border border-gray-300 text-gray-600 py-4 rounded-2xl font-semibold">Cancel</button></div></div></div>';
        document.body.appendChild(modal);
    }
    modal._consentData = data;
    document.getElementById("consent-agree").checked = false;
    modal.classList.remove("hidden");
}

function closeProviderConsent() {
    document.getElementById("provider-consent-modal").classList.add("hidden");
}

async function submitProviderWithConsent() {
    if (!document.getElementById("consent-agree").checked) {
        addInAppAlert("error", "Please accept the consent terms to continue");
        return;
    }
    closeProviderConsent();
    var consentData = document.getElementById("provider-consent-modal")._consentData;
    if (!consentData) return;

    var serviceList = [];
    for (var i = 0; i < consentData.selectedOptions.length; i++) {
        for (var j = 0; j < services.length; j++) {
            if (services[j].id === consentData.selectedOptions[i]) {
                serviceList.push(services[j]);
                break;
            }
        }
    }
    var serviceNames = serviceList.map(function(s) { return s.name; });

    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    var backendOk = await checkBackend();

    if (backendOk) {
        var nameParts = consentData.name.split(" ");
        var firstname = nameParts[0] || consentData.name;
        var lastname = nameParts.slice(1).join(" ") || nameParts[0] || consentData.name;
        try {
            var resp = await fetch(apiUrl + "/provider/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    firstname: firstname, lastname: lastname, email: consentData.email, phone: consentData.phone,
                    businessName: consentData.businessName, services: serviceNames,
                    password: consentData.password, confirmPassword: consentData.confirmPassword,
                    bitmoji: selectedBitmoji, location: consentData.location, bio: consentData.bio, experience: consentData.exp
                })
            });
            var respData = await resp.json();
            if (respData.success) {
                addNotification("\uD83C\uDF89", "Provider Application Submitted", consentData.name + " applied as a provider in " + (serviceList.length > 0 ? serviceList[0].name : "General") + ".");
                document.getElementById("provider-form").reset();
                document.getElementById("prov-name").value = "";
                document.getElementById("prov-phone").value = "";
                document.getElementById("prov-email").value = "";
                document.getElementById("prov-business").value = "";
                document.getElementById("prov-exp").value = "";
                document.getElementById("prov-password").value = "";
                document.getElementById("prov-confirm-password").value = "";
                document.getElementById("prov-location").value = "";
                document.getElementById("prov-bio").value = "";
                document.getElementById("multi-service-select").selectedIndex = -1;
                document.getElementById("agree-terms").checked = false;
                selectedBitmoji = null;
                document.getElementById("bitmoji-select").textContent = "\uD83D\uDC64";
                navigateTo("provider-tasks");
                addInAppAlert("success", "Application submitted successfully! Your account is now pending admin verification. You will be able to login once an administrator approves your application.");
                return;
            }
            if (data.error) { addInAppAlert("error", data.error); return; }
        } catch(e) { console.warn(e); }
        addInAppAlert("error", "Failed to submit application on server. Please try again.");
        return;
    }

    // Backend unavailable — online-only, cannot submit
    addInAppAlert("error", "Cannot submit application: Server is currently unavailable. Please try again later.");
}

// ============================================================
// PROVIDER LISTS ON SERVICES PAGE
// ============================================================

function renderServiceRatings() {
    // Aggregate ratings per service from userRatings and reviews
    var serviceRatings = {};
    for (var si = 0; si < services.length; si++) {
        serviceRatings[services[si].id] = [];
    }
    for (var ri = 0; ri < userRatings.length; ri++) {
        var r = userRatings[ri];
        if (!r.taskName) continue;
        var tn = r.taskName.toLowerCase();
        for (var si = 0; si < services.length; si++) {
            // Exact match or contains match on service name
            if (tn === services[si].name.toLowerCase() || tn.indexOf(services[si].name.toLowerCase()) !== -1) {
                serviceRatings[services[si].id].push(r.rating);
                break;
            }
        }
    }
    for (var vi = 0; vi < reviews.length; vi++) {
        var rv = reviews[vi];
        if (!rv.serviceName) continue;
        var sn = rv.serviceName.toLowerCase();
        for (var si = 0; si < services.length; si++) {
            if (sn === services[si].name.toLowerCase() || sn.indexOf(services[si].name.toLowerCase()) !== -1) {
                serviceRatings[services[si].id].push(rv.rating);
                break;
            }
        }
    }
    // Update DOM elements for every service that has a card
    for (var si = 0; si < services.length; si++) {
        var sid = services[si].id;
        var ratings = serviceRatings[sid] || [];
        var avg = ratings.length > 0 ? ratings.reduce(function(a, b) { return a + b; }, 0) / ratings.length : 0;
        var fullStars = Math.round(avg);
        var starStr = "";
        for (var s = 0; s < 5; s++) { starStr += s < fullStars ? "\u2605" : "\u2606"; }
        var starsEl = document.getElementById("stars-" + sid);
        var ratingEl = document.getElementById("rating-" + sid);
        if (starsEl) starsEl.textContent = starStr;
        if (ratingEl) ratingEl.textContent = avg > 0 ? avg.toFixed(1) + " Rating (" + ratings.length + ")" : "0.0 Rating";
    }
}

function renderAllProviderLists() {
    var providerMap = {};

    // Initialize provider map for all 22 service IDs
    for (var si = 0; si < services.length; si++) {
        providerMap[services[si].id + "-providers"] = [];
    }

    // Calculate provider ratings from userRatings
    var providerRatingMap = {};
    for (var ri = 0; ri < userRatings.length; ri++) {
        var ur = userRatings[ri];
        if (!ur.providerName) continue;
        var pn = ur.providerName.trim().toLowerCase();
        if (!providerRatingMap[pn]) providerRatingMap[pn] = [];
        providerRatingMap[pn].push(ur.rating);
    }
    function getAvgRating(name) {
        if (!name) return null;
        var key = name.trim().toLowerCase();
        var ratings = providerRatingMap[key];
        if (!ratings || ratings.length === 0) return null;
        var sum = 0;
        for (var i = 0; i < ratings.length; i++) sum += ratings[i];
        return sum / ratings.length;
    }

    var hasRegistered = registeredProviders.length > 0;

    // Calculate job counts from completed tasks per provider (match by name and business_name)
    var providerJobCounts = {};
    for (var ci = 0; ci < completedTasks.length; ci++) {
        var ct = completedTasks[ci];
        if (ct.providerName) {
            var pn = ct.providerName.trim().toLowerCase();
            if (!providerJobCounts[pn]) providerJobCounts[pn] = 0;
            providerJobCounts[pn]++;
        }
    }

    if (hasRegistered) {
        for (var i = 0; i < registeredProviders.length; i++) {
            var p = registeredProviders[i];
            if (p.services) {
                for (var j = 0; j < p.services.length; j++) {
                    var listId = p.services[j].id + "-providers";
                    if (providerMap[listId]) providerMap[listId].push(p);
                }
            } else {
                var keys = Object.keys(providerMap);
                var idx = Math.floor(Math.random() * keys.length);
                providerMap[keys[idx]].push(p);
            }
        }
    }

    var keys = Object.keys(providerMap);
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var el = document.getElementById(key);
        if (!el) continue;
        var providers = providerMap[key];
        if (providers.length === 0) {
            el.innerHTML = "<div class=\"text-center text-gray-400 py-6\"><i class=\"fa-solid fa-user-clock text-3xl mb-2\"></i><p class=\"text-sm\">No providers available yet</p></div>";
            continue;
        }
        var html = "";
        for (var i = 0; i < providers.length; i++) {
            var p = providers[i];
            var displayName = p.business_name || p.businessName || p.name || "";
            var avgRating = getAvgRating(displayName);
            // Also try matching by the p.name field
            if (avgRating === null && p.name) avgRating = getAvgRating(p.name);
            // Also try matching by email-based lookup against completedTasks
            var displayRating = avgRating !== null ? avgRating : (p.rating || 0);
            var stars = "";
            var r = Math.floor(displayRating);
            for (var s = 0; s < r; s++) stars += "\u2605";

            // Job count: match by display name and also check p.name as fallback
            var dnKey = displayName.trim().toLowerCase();
            var jobCount = providerJobCounts[dnKey] || 0;
            if (jobCount === 0 && p.name) {
                var pnKey = p.name.trim().toLowerCase();
                jobCount = providerJobCounts[pnKey] || 0;
            }
            // Fall back to provider's jobs field from backend
            if (jobCount === 0) jobCount = p.jobs || 0;

            var serviceId = key.replace("-providers", "");
            var isFav = false;
            for (var fi = 0; fi < favoriteProviders.length; fi++) {
                if (favoriteProviders[fi].email === p.email || favoriteProviders[fi].name === displayName) { isFav = true; break; }
            }
            var favIcon = isFav ? "fa-solid fa-heart text-red-500" : "fa-regular fa-heart text-gray-400";
            html += "<div class=\"flex items-center justify-between\" data-pkey=\"" + (p.email || '').replace(/'/g,"\\'") + "\">" +
                "<div class=\"flex items-center gap-3\">" +
                "<div class=\"bitmoji\">" + (p.bitmoji || "\uD83D\uDC64") + "</div>" +
                "<div><p class=\"font-medium text-sm\">" + displayName + "</p>" +
                "<div class=\"flex items-center gap-2 text-xs text-gray-500\">" +
                "<span class=\"text-yellow-500 rating-stars\">" + stars + "</span>" +
                "<span class=\"rating-value\">" + displayRating.toFixed(1) + "</span>" +
                "<span class=\"jobs-count\">\u2022 " + jobCount + " jobs</span></div></div>" +
                "<button onclick=\"toggleFavoriteProvider('" + (p.email || '').replace(/'/g,"\\'") + "','" + displayName.replace(/'/g,"\\'") + "')\" class=\"text-lg mr-2\"><i class=\"" + favIcon + "\"></i></button></div>" +
                "<button onclick=\"selectService('" + serviceId + "','" + displayName.replace(/'/g,"\\'") + "')\" class=\"mt-3 w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl text-sm font-medium transition-all\"><i class=\"fa-solid fa-bookmark mr-1\"></i> Book Now</button></div>";
        }
        el.innerHTML = html;
    }
    renderServiceRatings();
    updateServiceCardPrices();
}

function updateProviderUI() {
    var providerRatingMap = {};
    for (var ri = 0; ri < userRatings.length; ri++) {
        var ur = userRatings[ri];
        if (!ur.providerName) continue;
        var pn = ur.providerName.trim().toLowerCase();
        if (!providerRatingMap[pn]) providerRatingMap[pn] = [];
        providerRatingMap[pn].push(ur.rating);
    }
    function getAvg(name) {
        if (!name) return null;
        var key = name.trim().toLowerCase();
        var ratings = providerRatingMap[key];
        if (!ratings || ratings.length === 0) return null;
        var sum = 0;
        for (var i = 0; i < ratings.length; i++) sum += ratings[i];
        return sum / ratings.length;
    }
    var providerJobCounts = {};
    for (var ci = 0; ci < completedTasks.length; ci++) {
        var ct = completedTasks[ci];
        if (ct.providerName) {
            var pn = ct.providerName.trim().toLowerCase();
            if (!providerJobCounts[pn]) providerJobCounts[pn] = 0;
            providerJobCounts[pn]++;
        }
    }
    var cards = document.querySelectorAll('[data-pkey]');
    for (var ci = 0; ci < cards.length; ci++) {
        var card = cards[ci];
        var pkey = card.getAttribute('data-pkey');
        for (var pi = 0; pi < registeredProviders.length; pi++) {
            var p = registeredProviders[pi];
            if ((p.email && p.email === pkey) || pkey === 'noprofile-' + (p.business_name || p.name)) {
                var displayName = p.business_name || p.businessName || p.name || "";
                var avgRating = getAvg(displayName);
                if (avgRating === null && p.name) avgRating = getAvg(p.name);
                var displayRating = avgRating !== null ? avgRating : (p.rating || 0);
                var stars = "";
                var r = Math.floor(displayRating);
                for (var s = 0; s < r; s++) stars += "\u2605";
                var dnKey = displayName.trim().toLowerCase();
                var jobCount = providerJobCounts[dnKey] || 0;
                if (jobCount === 0 && p.name) {
                    var pnKey = p.name.trim().toLowerCase();
                    jobCount = providerJobCounts[pnKey] || 0;
                }
                if (jobCount === 0) jobCount = p.jobs || 0;
                var starsEl = card.querySelector('.rating-stars');
                var ratingEl = card.querySelector('.rating-value');
                var jobsEl = card.querySelector('.jobs-count');
                if (starsEl) starsEl.textContent = stars;
                if (ratingEl) ratingEl.textContent = displayRating.toFixed(1);
                if (jobsEl) jobsEl.textContent = "\u2022 " + jobCount + " jobs";
                var isFav = false;
                for (var fi = 0; fi < favoriteProviders.length; fi++) {
                    if (favoriteProviders[fi].email === p.email || favoriteProviders[fi].name === displayName) { isFav = true; break; }
                }
                var heartEl = card.querySelector('button i');
                if (heartEl) {
                    heartEl.className = isFav ? "fa-solid fa-heart text-red-500" : "fa-regular fa-heart text-gray-400";
                }
                break;
            }
        }
    }
    renderServiceRatings();
    updateServiceCardPrices();
}

function updateServiceCardPrices() {
    for (var i = 0; i < services.length; i++) {
        var s = services[i];
        var el = document.getElementById("card-price-" + s.id);
        if (el) {
            var priceK = Math.round(s.basePrice / 1000);
            el.textContent = priceK + "k";
        }
    }
}

function toggleFavoriteProvider(email, name) {
    for (var fi = 0; fi < favoriteProviders.length; fi++) {
        if (favoriteProviders[fi].email === email || favoriteProviders[fi].name === name) {
            favoriteProviders.splice(fi, 1);
            updateProviderUI();
            updateProfileWithUser();
            saveAppState();
            return;
        }
    }
    favoriteProviders.push({ email: email, name: name });
    updateProviderUI();
    updateProfileWithUser();
    saveAppState();
}

function startHeroSlider() {
    var slides = document.querySelectorAll(".hero-bg-slide");
    if (slides.length === 0) return;
    var current = 0;
    setInterval(function() {
        for (var i = 0; i < slides.length; i++) {
            slides[i].classList.remove("active");
        }
        current = (current + 1) % slides.length;
        slides[current].classList.add("active");
    }, 4000);
}

// ============================================================
// REVIEWS
// ============================================================

function showAddReviewModal() {
    if (!currentUser) { addInAppAlert("info", "Please login first to submit a review"); showAuthModal("login"); return; }
    currentReviewStars = 0;
    document.getElementById("review-text").value = "";
    var stars = document.querySelectorAll("#star-rating span");
    for (var i = 0; i < stars.length; i++) {
        stars[i].textContent = "\u2606";
    }
    document.getElementById("add-review-modal").classList.remove("hidden");
}

function setReviewStars(n) {
    currentReviewStars = n;
    var stars = document.querySelectorAll("#star-rating span");
    for (var i = 0; i < stars.length; i++) {
        stars[i].textContent = i < n ? "\u2605" : "\u2606";
    }
}

async function submitReview() {
    var text = sanitizeInput(document.getElementById("review-text").value.trim());
    if (!text) { addInAppAlert("error", "Please write a review"); return; }
    if (currentReviewStars === 0) { addInAppAlert("error", "Please select a rating"); return; }

    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    var backendOk = await checkBackend();
    if (backendOk && window.__HAVENGO_JWT__) {
        try {
            var resp = await fetch(apiUrl + "/reviews", {
                method: "POST",
                headers: { "Authorization": "Bearer " + window.__HAVENGO_JWT__, "Content-Type": "application/json" },
                body: JSON.stringify({ rating: currentReviewStars, text: text })
            });
            if (resp.ok) {
                closeModal("add-review-modal");
                await loadReviews();
                renderServiceRatings();
                addNotification("\u2B50", "New Review Added", "Thank you for your feedback!");
                addInAppAlert("success", "Review submitted successfully!");
                return;
            }
        } catch(e) { console.warn(e); }
    }

    reviews.push({
        name: currentUser ? (currentUser.name || currentUser.firstname + " " + currentUser.lastname) : "Guest User",
        img: profilePicSrc,
        rating: currentReviewStars,
        text: text
    });
    closeModal("add-review-modal");
    renderReviews();
    renderServiceRatings();
    saveAppState();
    addNotification("\u2B50", "New Review Added", "Thank you for your feedback!");
    addInAppAlert("success", "Review submitted successfully!");
}

async function loadReviews() {
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    if (await checkBackend()) {
        try {
            var resp = await fetch(apiUrl + "/reviews");
            if (resp.ok) {
                var data = await resp.json();
                reviews = data.map(function(r) {
                    return { name: r.name, rating: r.rating, text: r.text, created_at: r.created_at };
                });
                renderReviews();
                return;
            }
        } catch(e) { console.warn(e); }
    }
    // No backend — reviews already loaded from localStorage
    renderReviews();
}

// Fetch verified providers from backend for service listing
async function fetchVerifiedProviders() {
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    try {
        var resp = await fetch(apiUrl + "/providers/verified");
        if (resp.ok) {
            var data = await resp.json();
            var backendEmails = {};
            if (data && data.length > 0) {
                for (var i = 0; i < data.length; i++) {
                    var bp = data[i];
                    backendEmails[bp.email] = true;
                    var existing = false;
                    for (var j = 0; j < registeredProviders.length; j++) {
                        if (registeredProviders[j].email === bp.email) { existing = true; break; }
                    }
                    if (!existing) {
                        var svcs = parseProviderServices(bp.services);
                        registeredProviders.push({
                            id: bp.id, name: bp.business_name || bp.name, business_name: bp.business_name,
                            email: bp.email, phone: bp.phone || "", firstname: bp.name ? bp.name.split(" ")[0] : "",
                            lastname: bp.name ? bp.name.split(" ").slice(1).join(" ") : "",
                            services: svcs, bitmoji: bp.bitmoji || "\uD83D\uDC64",
                            verified: true, jobs: bp.jobs || 0,
                            location: bp.location || "", bio: bp.bio || ""
                        });
                    }
                }
            }
            // Remove providers no longer verified by backend
            for (var ri = registeredProviders.length - 1; ri >= 0; ri--) {
                var rp = registeredProviders[ri];
                // Only remove providers that have an email (backend-sourced) but are not in backend response
                if (rp.email && !backendEmails[rp.email] && rp.id) {
                    registeredProviders.splice(ri, 1);
                }
            }
            renderAllProviderLists();
        }
    } catch(e) { console.warn(e); }
}

function renderReviews() {
    var grid = document.getElementById("reviews-grid");
    if (!grid) return;
    var html = "";
    if (reviews.length === 0) {
        html = "<div class=\"col-span-full text-center py-16 text-gray-400\"><i class=\"fa-solid fa-star text-5xl mb-4\"></i><p class=\"text-xl font-medium\">No reviews yet</p><p class=\"text-sm\">Be the first to share your experience!</p></div>";
    } else {
        var showCount = Math.min(reviews.length, 6);
        for (var i = 0; i < showCount; i++) {
            var r = reviews[i];
            var stars = "";
            for (var s = 0; s < 5; s++) {
                stars += s < r.rating ? "\u2605" : "\u2606";
            }
            html += "<div class=\"bg-white rounded-3xl p-8 shadow\">" +
                "<div class=\"flex items-center gap-4 mb-5\">" +
                "<div class=\"w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-2xl font-bold text-emerald-600\">" + r.name.charAt(0).toUpperCase() + "</div>" +
                "<div><h4 class=\"font-bold\">" + r.name + "</h4>" +
                "<p class=\"text-yellow-500\">" + stars + "</p></div></div>" +
                "<p class=\"text-gray-600\">\"" + r.text + "\"</p></div>";
        }
        if (reviews.length > 6) {
            html += "<div class=\"col-span-full text-center mt-4\"><button onclick=\"showAllReviews()\" class=\"bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl font-medium\">Show All (" + reviews.length + " reviews)</button></div>";
        }
    }
    grid.innerHTML = html;
    grid._fullListShown = false;
}

function showAllReviews() {
    var grid = document.getElementById("reviews-grid");
    if (!grid) return;
    var html = "";
    for (var i = 0; i < reviews.length; i++) {
        var r = reviews[i];
        var stars = "";
        for (var s = 0; s < 5; s++) {
            stars += s < r.rating ? "\u2605" : "\u2606";
        }
        html += "<div class=\"bg-white rounded-3xl p-8 shadow\">" +
            "<div class=\"flex items-center gap-4 mb-5\">" +
            "<div class=\"w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-2xl font-bold text-emerald-600\">" + r.name.charAt(0).toUpperCase() + "</div>" +
            "<div><h4 class=\"font-bold\">" + r.name + "</h4>" +
            "<p class=\"text-yellow-500\">" + stars + "</p></div></div>" +
            "<p class=\"text-gray-600\">\"" + r.text + "\"</p></div>";
    }
    html += "<div class=\"col-span-full text-center mt-4\"><button onclick=\"renderReviews()\" class=\"bg-gray-600 hover:bg-gray-700 text-white px-6 py-3 rounded-2xl font-medium\">Show Less</button></div>";
    grid.innerHTML = html;
    grid._fullListShown = true;
}

// ============================================================
// PROVIDER PROFILE
// ============================================================

function openProviderProfile(name) {
    document.getElementById("provider-name").textContent = name;
    document.getElementById("provider-modal").classList.remove("hidden");
}

// ============================================================
// AUTO-PAYMENT CHECK (10-hour window)
// ============================================================

function checkAutoPayment() {
    var now = new Date().getTime();
    var changed = false;
    var customerPendingCount = 0;
    for (var i = 0; i < pendingPayments.length; i++) {
        var pp = pendingPayments[i];
        if (!pp.paid && pp.completedAt) {
            var elapsed = now - pp.completedAt;
            // 2-min reminder (only once)
            if (elapsed >= 120000 && elapsed < 180000 && !pp._reminded) {
                pp._reminded = true;
                addNotification("\u23F0", "Payment Due Soon", "UGX " + pp.amount.toLocaleString() + " for " + pp.taskName + " is due. Pay within 10 hours or auto-deducted.");
            }
            // 10-hour auto-payment
            if (elapsed >= 36000000) {
                if (userBalance >= pp.amount) {
                    userBalance -= pp.amount;
                    pp.paid = true;
                    var providerShare = Math.round(pp.amount * 0.85);
                    var systemShare = pp.amount - providerShare;
                    if (pp.providerName) {
                        if (!providerEarningsMap[pp.providerName]) providerEarningsMap[pp.providerName] = 0;
                        providerEarningsMap[pp.providerName] += providerShare;
                    }
                    earnings += providerShare;
                    changed = true;
                    addNotification("\u23F0", "Auto-Payment Processed", "UGX " + pp.amount.toLocaleString() + " auto-deducted for " + pp.taskName + " (10-hour window expired)");
                }
            }
            if (currentUser) customerPendingCount++;
        }
    }
    // Update pending count badge in profile
    var pendingBadge = document.getElementById("pending-payment-count");
    if (pendingBadge) {
        pendingBadge.textContent = customerPendingCount;
        pendingBadge.classList.toggle("hidden", customerPendingCount === 0);
    }
    if (changed) {
        renderProfilePage();
        if (currentLoggedProvider) renderProviderDashboard();
        saveAppState();
    }
}

// ============================================================
// BACKEND NOTIFICATIONS
// ============================================================

async function fetchBackendNotifications() {
    var jwt = window.__HAVENGO_JWT__;
    if (!jwt) return;
    var apiUrl = HAVENGO_BACKEND_URL + "/api";
    var route = "", markRoute = "";
    if (currentAdmin) { route = "/admin/notifications"; markRoute = "/admin/notifications/mark-seen"; }
    else if (currentLoggedProvider) { route = "/provider/notifications"; markRoute = "/provider/notifications/mark-seen"; }
    else if (currentUser) { route = "/customer/notifications"; markRoute = "/customer/notifications/mark-seen"; }
    if (!route) return;
    try {
        var resp = await fetch(apiUrl + route, { headers: { "Authorization": "Bearer " + jwt } });
        if (resp.status === 401) {
            var errData = await resp.json().catch(function(){ return {}; });
            if (errData.session_expired) { handleSessionExpired(); return; }
        }
        if (resp.ok) {
            var notifs = await resp.json();
            if (notifs && notifs.length > 0) {
                for (var ni = 0; ni < notifs.length; ni++) {
                    var n = notifs[ni];
                    var exists = globalNotifications.some(function(gn) { return gn.notifId === n.id; });
                    if (!exists) {
                        addNotification(n.icon || "\uD83D\uDCE2", n.title || "Notification", n.message || "", n.id);
                    }
                }
            }
            // Mark as seen on backend so they aren't returned again
            if (markRoute) {
                fetch(apiUrl + markRoute, { method: "POST", headers: { "Authorization": "Bearer " + jwt } }).catch(function(e){ console.warn("Mark-seen failed:", e); });
            }
        }
    } catch(e) { console.warn(e); }
}

// ============================================================
// WINDOW ONLOAD
// ============================================================

window.onload = function() {
    try { if (localStorage.getItem("havengo-dark") === "1") { document.documentElement.classList.add("dark"); var s = document.getElementById("stars-container"); if (s) s.classList.remove("hidden"); } } catch(e) { console.warn("Dark restore:", e); }
    try { var t = localStorage.getItem("havengo-theme"); if (t && t !== "default") document.documentElement.classList.add("theme-" + t); } catch(e) { console.warn("Theme restore:", e); }
    try { createStars(); } catch(e) { console.warn("createStars:", e); }

    try { var up = new URLSearchParams(window.location.search); if (up.get("token") && up.get("email")) { navigateTo("reset-password-page"); return; } } catch(e) { console.warn("Token:", e); }

    try { startHeroSlider(); } catch(e) { console.warn("heroSlider:", e); }
    try { renderBlogPosts(); } catch(e) { console.warn("blogPosts:", e); }
    try { loadReviews(); } catch(e) { console.warn("loadReviews:", e); }
    try { populateMultiServiceSelect(); } catch(e) { console.warn("multiService:", e); }
    try { populateBitmojiSelect(); } catch(e) { console.warn("bitmojiSelect:", e); }
    try { renderServiceRatings(); } catch(e) { console.warn("serviceRatings:", e); }
    try { populateServiceFilters(); } catch(e) { console.warn("serviceFilters:", e); }

    try { addNotification("\uD83D\uDC4B", "Welcome to HavenGo", "Browse services or sign up to get started!"); } catch(e) { console.warn("notif:", e); }

    try { setInterval(checkAutoPayment, 60000); } catch(e) { console.warn("autoPay:", e); }
    try { setInterval(processExpiredDeletions, 300000); processExpiredDeletions(); } catch(e) { console.warn("del:", e); }

    try {
        var modals = document.querySelectorAll(".modal");
        for (var i = 0; i < modals.length; i++) {
            modals[i].addEventListener("click", function(e) {
                if (e.target === this) { this.classList.add("hidden"); }
            });
        }
    } catch(e) { console.warn("modals:", e); }

    (async function() {
        try { await loadAppState(); } catch(e) { console.warn("loadState:", e); }
        try { if (currentAdmin) {
            document.getElementById("admin-login-screen").classList.add("hidden");
            document.getElementById("admin-dashboard").classList.remove("hidden");
            document.getElementById("admin-header").classList.remove("hidden");
            document.getElementById("admin-nav-link").classList.remove("hidden");
            renderAdminDashboard(); _syncAdminData(); fetchBackendNotifications(); updateNotifCount();
            if (window.__adminTab !== undefined) switchAdminTab(window.__adminTab);
        } } catch(e) { console.warn("adminRestore:", e); }
        try { if (currentLoggedProvider) {
            document.getElementById("provider-login-screen").classList.add("hidden");
            document.getElementById("provider-dashboard").classList.remove("hidden");
            document.getElementById("provider-header").classList.remove("hidden");
            var prov = currentLoggedProvider;
            document.getElementById("logged-provider-name").textContent = prov.business_name || prov.name;
            document.getElementById("logged-provider-service").textContent = (prov.service || "General") + " \u2022 " + (prov.location || "");
            renderProviderDashboard(); fetchBackendNotifications(); updateNotifCount();
            if (window.__providerTab !== undefined) switchProviderTab(window.__providerTab);
        } } catch(e) { console.warn("providerRestore:", e); }
        try { if (currentUser) {
            updateProfileWithUser(); renderProfilePage(); updateProfilePicCursor();
            fetchBackendNotifications(); fetchCustomerBookings(); fetchPendingPayments();
            renderBookings(); updateNotifCount(); startAutoPaymentCheck();
        } } catch(e) { console.warn("userRestore:", e); }
        try { if (!currentAdmin && !currentLoggedProvider && !currentUser) { updateNotifCount(); } } catch(e) { console.warn("notifCount:", e); }
        try { renderAllProviderLists(); } catch(e) { console.warn("providerLists:", e); }
        try { if (window.__currentPage) { var pe = document.getElementById(window.__currentPage); if (pe) navigateTo(window.__currentPage); } } catch(e) { console.warn("pageRestore:", e); }
    })();

    try { setInterval(saveAppState, 10000); } catch(e) { console.warn("autoSave:", e); }

    try { window.addEventListener("beforeunload", function() { window.__currentPage = null; window.__providerTab = 0; window.__adminTab = 0; saveAppState(); }); } catch(e) { console.warn("beforeunload:", e); }

    (async function() {
        try {
            var apiUrl = HAVENGO_BACKEND_URL + "/api";
            var resp = await fetch(apiUrl + "/health");
            if (resp.ok) { window.__HAVENGO_BACKEND__ = true; window.__HAVENGO_API__ = apiUrl; console.log("HavenGo Backend connected at", apiUrl); }
        } catch(e) { console.log("Backend not available, using local mode"); }
    })();

    try { fetchVerifiedProviders(); } catch(e) { console.warn("fetchVP:", e); }
    try { setInterval(fetchVerifiedProviders, 15000); } catch(e) { console.warn("pollVP:", e); }

    try { setInterval(function() {
        if (currentUser && window.__HAVENGO_JWT__) { fetchCustomerBookings(); fetchPendingPayments(); fetchBackendNotifications(); updateProfileWithUser(); }
        if (currentLoggedProvider && window.__HAVENGO_JWT__) { fetchBackendNotifications(); }
        if (currentAdmin && window.__HAVENGO_JWT__) { fetchBackendNotifications(); }
    }, 15000); } catch(e) { console.warn("autoSync:", e); }
};






