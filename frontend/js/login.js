// API_BASE is provided by config.js (loaded before this script)

// Get Active Center from URL
const urlParams = new URLSearchParams(window.location.search);
const activeCenter = urlParams.get("center") || "BANK";

// DOM Elements - Views
const signinView = document.getElementById("signin-view");
const signupView = document.getElementById("signup-view");

// DOM Elements - Toggles
const toSignupBtn = document.getElementById("to-signup-btn");
const toSigninBtn = document.getElementById("to-signin-btn");

// DOM Elements - Sign In
const signinEmail = document.getElementById("signin-email");
const signinPassword = document.getElementById("signin-password");
const signinBtn = document.getElementById("signin-btn");
const signinError = document.getElementById("signin-error");

// DOM Elements - Sign Up
const signupEmail = document.getElementById("signup-email");
const signupPassword = document.getElementById("signup-password");
const signupConfirm = document.getElementById("signup-confirm-password");
const signupBtn = document.getElementById("signup-btn");
const signupError = document.getElementById("signup-error");

const officeTypeTag = document.getElementById("office-type-tag");

// Initialize Label
officeTypeTag.textContent = activeCenter.replace("_", " ");

// View Toggle Event Listeners
toSignupBtn.addEventListener("click", () => {
    signinView.style.display = "none";
    signupView.style.display = "block";
    signinError.style.display = "none";
});

toSigninBtn.addEventListener("click", () => {
    signupView.style.display = "none";
    signinView.style.display = "block";
    signupError.style.display = "none";
});

// Handle Sign In Submit
signinBtn.addEventListener("click", async () => {
    const email = signinEmail.value.trim();
    const password = signinPassword.value.trim();
    
    if (!email || !password) {
        showSigninError("Please enter your email and password.");
        return;
    }
    
    signinBtn.disabled = true;
    signinError.style.display = "none";
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email,
                password: password,
                office_type: activeCenter
            })
        });
        
        if (response.status === 401) {
            showSigninError("Invalid email or password for this center.");
            return;
        }
        
        if (!response.ok) throw new Error("Authentication failed");
        
        const user = await response.json();
        
        // Save session
        sessionStorage.setItem("userToken", user.token);
        sessionStorage.setItem("userRole", user.role);
        sessionStorage.setItem("userEmail", user.email);
        sessionStorage.setItem("userOffice", user.office_type);
        
        // Redirect based on role
        redirectByRole(user.role);
        
    } catch (err) {
        showSigninError("Server connection failed. Make sure backend is running.");
        console.error(err);
    } finally {
        signinBtn.disabled = false;
    }
});

// Handle Sign Up Submit
signupBtn.addEventListener("click", async () => {
    const email = signupEmail.value.trim();
    const password = signupPassword.value.trim();
    const confirm = signupConfirm.value.trim();
    
    if (!email || !password || !confirm) {
        showSignupError("Please fill out all signup fields.");
        return;
    }
    if (password.length < 5) {
        showSignupError("Password must be at least 5 characters long.");
        return;
    }
    if (password !== confirm) {
        showSignupError("Passwords do not match.");
        return;
    }
    
    signupBtn.disabled = true;
    signupError.style.display = "none";
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/signup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                email: email,
                password: password,
                office_type: activeCenter
            })
        });
        
        if (response.status === 400) {
            showSignupError("Email address is already registered.");
            return;
        }
        
        if (!response.ok) throw new Error("Registration failed");
        
        const user = await response.json();
        
        // Save session
        sessionStorage.setItem("userToken", user.token);
        sessionStorage.setItem("userRole", user.role);
        sessionStorage.setItem("userEmail", user.email);
        sessionStorage.setItem("userOffice", user.office_type);
        
        // Customers redirect to kiosk
        redirectByRole(user.role);
        
    } catch (err) {
        showSignupError("Server connection failed.");
        console.error(err);
    } finally {
        signupBtn.disabled = false;
    }
});

function showSigninError(msg) {
    signinError.textContent = msg;
    signinError.style.display = "block";
}

function showSignupError(msg) {
    signupError.textContent = msg;
    signupError.style.display = "block";
}

function redirectByRole(role) {
    // Navigate with the active center as query parameter
    if (role === "admin") {
        window.location.href = `/static/admin.html?center=${activeCenter}`;
    } else if (role === "agent") {
        window.location.href = `/static/agent.html?center=${activeCenter}`;
    } else if (role === "tv") {
        window.location.href = `/static/tv.html?center=${activeCenter}`;
    } else {
        window.location.href = `/static/kiosk.html?center=${activeCenter}`;
    }
}
