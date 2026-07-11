// API_BASE and WS_BASE are provided by config.js (loaded before this script)

// Verify Session
const sessionToken = sessionStorage.getItem("userToken");
const sessionRole = sessionStorage.getItem("userRole");
const sessionOffice = sessionStorage.getItem("userOffice") || "BANK";

if (!sessionToken || sessionRole !== "customer") {
    window.location.href = "/static/index.html";
}

// Request notification permissions
if ("Notification" in window) {
    console.log("Notifications API supported. Current permission:", Notification.permission);
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            console.log("Notification permission requested. Result:", permission);
        });
    }
} else {
    console.warn("Notifications API is not supported by this browser.");
}

// Service mappings based on office type
const OFFICE_SERVICES = {
    BANK: [
        { code: "AC", name: "Account Opening & KYC", desc: "Open new account, submit documentations, update address", icon: "👤" },
        { code: "CS", name: "Cash Transactions", desc: "Deposit cash, withdraw money, process cheques", icon: "💵" },
        { code: "AD", name: "Aadhaar & Loans", desc: "Aadhaar update, loan applications, FD/RD setups", icon: "💼" }
    ],
    ESEVAI: [
        { code: "RV", name: "Revenue Certificates", desc: "Community, Income, Nativity, First Graduate certificates", icon: "📝" },
        { code: "SS", name: "Pension Schemes", desc: "Old Age Pension, Destitute Widow, Disability pension", icon: "👵" },
        { code: "LD", name: "Land & Utilities", desc: "Patta transfer, Chitta, A-Register, Electricity bills", icon: "🏠" }
    ],
    POST_OFFICE: [
        { code: "MP", name: "Mails & Parcels", desc: "Speed Post, Registered Post, domestic/international mail", icon: "📦" },
        { code: "SB", name: "Savings Bank & Money transfer", desc: "Post office savings account, IPPB, Money orders", icon: "🏦" },
        { code: "INS", name: "Postal Life Insurance", desc: "PLI, RPLI, Pradhan Mantri Bima Yojana applications", icon: "🛡️" },
        { code: "RT", name: "Retail & Aadhaar", desc: "Aadhaar services, Passport Seva Seva, stamps purchase", icon: "🛍️" }
    ],
    MUNICIPAL: [
        { code: "CR", name: "Civil Registration", desc: "Birth certificate, Death certificate, Marriage registration", icon: "👶" },
        { code: "TX", name: "Taxation & Payments", desc: "Property tax, professional tax payment, trade licensing dues", icon: "🪙" },
        { code: "PL", name: "Permits & Licenses", desc: "Building permissions, construction approvals, license renewal", icon: "🏗️" },
        { code: "UG", name: "Utilities & Grievances", desc: "Water connection request, drainage issues, municipal complaints", icon: "🛠️" }
    ]
};

let selectedService = null;

// DOM Elements
const officeTypeTag = document.getElementById("office-type-tag");
const servicesGrid = document.getElementById("services-grid");
const phoneModal = document.getElementById("phone-modal");
const successModal = document.getElementById("success-modal");
const phoneInput = document.getElementById("phone-input");

const modalServiceName = document.getElementById("modal-service-name");
const modalCancelBtn = document.getElementById("modal-cancel-btn");
const modalConfirmBtn = document.getElementById("modal-confirm-btn");

const ticketNumber = document.getElementById("ticket-number");
const ticketService = document.getElementById("ticket-service");
const ticketTime = document.getElementById("ticket-time");
const successCloseBtn = document.getElementById("success-close-btn");

const activeCalledDisplay = document.getElementById("active-called-display");
const customerLogoutBtn = document.getElementById("customer-logout-btn");

// Logout Action
customerLogoutBtn.addEventListener("click", () => {
    sessionStorage.clear();
    window.location.href = "/static/index.html";
});

// Initialize Kiosk
async function initKiosk() {
    officeTypeTag.textContent = sessionOffice.replace("_", " ");
    renderServices(sessionOffice);
    loadActiveServingToken();
}

// Render service cards based on office type
function renderServices(officeType) {
    const services = OFFICE_SERVICES[officeType] || OFFICE_SERVICES.BANK;
    servicesGrid.innerHTML = "";
    
    services.forEach(service => {
        const card = document.createElement("div");
        card.className = "menu-card glass-container";
        card.innerHTML = `
            <div class="card-icon">${service.icon}</div>
            <div class="card-title">${service.name}</div>
            <div class="card-desc">${service.desc}</div>
        `;
        card.addEventListener("click", () => openPhoneModal(service));
        servicesGrid.appendChild(card);
    });
}

// Fetch and display active called token
async function loadActiveServingToken() {
    try {
        const response = await fetch(`${API_BASE}/api/queues/status?office_type=${sessionOffice}`);
        const status = await response.json();
        
        if (status.active_tokens && status.active_tokens.length > 0) {
            const lastCalled = status.active_tokens[status.active_tokens.length - 1];
            activeCalledDisplay.textContent = `${lastCalled.token_number} at Counter ${lastCalled.counter_assigned}`;
        } else {
            activeCalledDisplay.textContent = "None (Lobby Quiet)";
        }
    } catch (err) {
        console.error("Error fetching active serving status:", err);
    }
}

// Open Phone entry Modal
function openPhoneModal(service) {
    selectedService = service;
    modalServiceName.textContent = service.name;
    phoneInput.value = "";
    phoneModal.classList.add("active");
}

// Close Phone Modal
modalCancelBtn.addEventListener("click", () => {
    phoneModal.classList.remove("active");
    selectedService = null;
});

// Generate Token
modalConfirmBtn.addEventListener("click", async () => {
    if (!selectedService) return;
    
    const customerInfo = phoneInput.value.trim();
    modalConfirmBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/api/tokens/generate?office_type=${sessionOffice}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                service_code: selectedService.code,
                service_name: selectedService.name,
                customer_info: customerInfo || null
            })
        });
        
        if (!response.ok) throw new Error("Failed to generate token");
        
        const token = await response.json();
        
        // Save the generated token to session to track for targeted notifications
        sessionStorage.setItem("activeCustomerToken", token.token_number);
        console.log("Saved active customer token to session storage:", token.token_number);
        
        // Hide phone modal
        phoneModal.classList.remove("active");
        
        // Show ticket success modal
        ticketNumber.textContent = token.token_number;
        ticketService.textContent = token.service_name;
        
        const dateStr = new Date(token.created_at).toLocaleString();
        ticketTime.textContent = dateStr;
        
        // Display AI Predicted Wait Time
        const ticketEta = document.getElementById("ticket-eta");
        if (ticketEta) {
            if (token.estimated_wait_minutes !== null && token.estimated_wait_minutes !== undefined) {
                ticketEta.textContent = `~${token.estimated_wait_minutes.toFixed(1)} mins`;
            } else {
                ticketEta.textContent = "Calculating...";
            }
        }
        
        successModal.classList.add("active");
        
    } catch (err) {
        alert("Error generating token. Please check backend server.");
        console.error(err);
    } finally {
        modalConfirmBtn.disabled = false;
    }
});

// Close Success Modal
successCloseBtn.addEventListener("click", () => {
    successModal.classList.remove("active");
});

// Setup WebSocket Listener
function setupWebSocket() {
    const socket = new WebSocket(`${WS_BASE}/ws/queue`);
    
    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log("WebSocket event received on Kiosk:", msg);
        
        // Filter by office type
        if (msg.office_type && msg.office_type !== sessionOffice) {
            return;
        }
        
        if (msg.type === "CALL_TOKEN") {
            loadActiveServingToken();
            
            const myToken = sessionStorage.getItem("activeCustomerToken");
            const calledToken = msg.data;
            
            console.log("Comparing called token", calledToken.token_number, "with my saved token", myToken);
            
            if (myToken && calledToken.token_number === myToken) {
                console.log("Targeted token match! Attempting web notification. Status:", Notification.permission);
                if ("Notification" in window) {
                    if (Notification.permission === "granted") {
                        try {
                            const notification = new Notification("🔔 Your Token Has Been Called!", {
                                body: `Token ${calledToken.token_number}, please proceed immediately to Counter ${calledToken.counter_assigned}.`,
                                requireInteraction: true
                            });
                            console.log("Notification object successfully created:", notification);
                        } catch (err) {
                            console.error("Failed to build notification card:", err);
                        }
                    } else {
                        console.warn("Cannot show notification: permission is", Notification.permission);
                    }
                }
            }
        } else if (msg.type === "UPDATE_STATUS" || msg.type === "NEW_TOKEN") {
            loadActiveServingToken();
        }
    };
    
    socket.onclose = () => {
        setTimeout(setupWebSocket, 3000);
    };
}

// Start application
initKiosk();
setupWebSocket();
