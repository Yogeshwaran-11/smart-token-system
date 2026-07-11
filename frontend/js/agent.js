// API_BASE and WS_BASE are provided by config.js (loaded before this script)

// Verify Session
const sessionToken = sessionStorage.getItem("userToken");
const sessionRole = sessionStorage.getItem("userRole");
const sessionOffice = sessionStorage.getItem("userOffice") || "BANK";

if (!sessionToken || sessionRole !== "agent") {
    window.location.href = "/static/index.html";
}

let counterNumber = null;
let activeToken = null;

// DOM Elements
const loginSection = document.getElementById("login-section");
const workstationSection = document.getElementById("workstation-section");
const counterSelect = document.getElementById("counter-select");
const loginBtn = document.getElementById("login-btn");
const counterDisplay = document.getElementById("counter-display");
const officeTypeTag = document.getElementById("office-type-tag");

const activeTokenCard = document.getElementById("active-token-card");
const statusBadge = document.getElementById("status-badge");
const callNextBtn = document.getElementById("call-next-btn");
const recallBtn = document.getElementById("recall-btn");
const completeBtn = document.getElementById("complete-btn");
const missedBtn = document.getElementById("missed-btn");

const waitingCount = document.getElementById("waiting-count");
const queuePreview = document.getElementById("queue-preview");
const agentLogoutBtn = document.getElementById("agent-logout-btn");

// Logout Action
agentLogoutBtn.addEventListener("click", async () => {
    if (counterNumber) {
        try {
            await fetch(`${API_BASE}/api/counters/${counterNumber}/logout?office_type=${sessionOffice}`, {
                method: "POST"
            });
        } catch (err) {
            console.error("Error logging out counter agent:", err);
        }
    }
    sessionStorage.clear();
    window.location.href = "/static/index.html";
});

// Initialize Agent Dashboard
async function initAgent() {
    officeTypeTag.textContent = sessionOffice.replace("_", " ");
    await loadCountersDropdown();
}

async function loadCountersDropdown() {
    try {
        const response = await fetch(`${API_BASE}/api/counters?office_type=${sessionOffice}`);
        const counters = await response.json();
        
        counterSelect.innerHTML = "";
        const activeCounters = counters.filter(c => c.is_active);
        
        if (activeCounters.length === 0) {
            const opt = document.createElement("option");
            opt.textContent = "No active counters";
            opt.disabled = true;
            counterSelect.appendChild(opt);
            loginBtn.disabled = true;
            return;
        }
        
        loginBtn.disabled = false;
        activeCounters.forEach(counter => {
            const opt = document.createElement("option");
            opt.value = counter.counter_number;
            opt.textContent = `Counter ${counter.counter_number}`;
            counterSelect.appendChild(opt);
        });
    } catch (err) {
        console.error("Error loading counters dropdown:", err);
    }
}

// Log in counter
loginBtn.addEventListener("click", async () => {
    counterNumber = parseInt(counterSelect.value);
    const agentEmail = sessionStorage.getItem("userEmail") || "";
    
    try {
        await fetch(`${API_BASE}/api/counters/${counterNumber}/agent?office_type=${sessionOffice}&agent_email=${encodeURIComponent(agentEmail)}`, {
            method: "POST"
        });
    } catch (err) {
        console.error("Error setting agent counter on backend:", err);
    }
    
    loginSection.style.display = "none";
    workstationSection.style.display = "grid";
    counterDisplay.textContent = `Counter ${counterNumber}`;
    counterDisplay.style.background = "rgba(16, 185, 129, 0.15)";
    counterDisplay.style.color = "#34d399";
    
    // Connect WebSocket
    setupWebSocket();
    
    // Load initial queue data
    refreshQueueState();
});

// Refresh waiting queue and details
async function refreshQueueState() {
    try {
        const response = await fetch(`${API_BASE}/api/queues/status?office_type=${sessionOffice}`);
        const status = await response.json();
        
        waitingCount.textContent = status.pending_count;
        renderQueuePreview(status.pending_tokens);
        
        // Find if this counter is currently serving any token (e.g. on page refresh)
        const myActiveToken = status.active_tokens.find(t => t.counter_assigned === counterNumber);
        if (myActiveToken) {
            setActiveToken(myActiveToken);
        } else if (!activeToken) {
            setNoActiveToken();
        }
    } catch (err) {
        console.error("Error refreshing queue state:", err);
    }
}

// Render Lobby Queue Preview
function renderQueuePreview(pendingTokens) {
    if (pendingTokens.length === 0) {
        queuePreview.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">No customers waiting</div>`;
        return;
    }
    
    queuePreview.innerHTML = "";
    pendingTokens.slice(0, 5).forEach(token => {
        const item = document.createElement("div");
        item.className = "waiting-item glass-container";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        
        const estMinutes = token.estimated_wait_minutes !== null && token.estimated_wait_minutes !== undefined 
            ? `~${Math.round(token.estimated_wait_minutes)}m` 
            : "--";
            
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span class="waiting-item-token">${token.token_number}</span>
                <span class="waiting-item-service" style="font-size: 0.85rem;">${token.service_name}</span>
            </div>
            <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-warning); background: rgba(245, 158, 11, 0.08); padding: 0.15rem 0.35rem; border-radius: 4px;">
                ⏱️ ${estMinutes}
            </span>
        `;
        queuePreview.appendChild(item);
    });
}

// Set Active Token UI
function setActiveToken(token) {
    activeToken = token;
    statusBadge.textContent = "Serving";
    statusBadge.style.background = "rgba(16, 185, 129, 0.15)";
    statusBadge.style.color = "#34d399";
    
    activeTokenCard.innerHTML = `
        <div class="detail-token-num">${token.token_number}</div>
        <div class="detail-token-service">${token.service_name}</div>
        <div class="detail-token-info">
            ${token.customer_info ? `📞 Phone: ${token.customer_info}` : '👤 Walk-in Customer (Anonymous)'}
        </div>
    `;
    
    // Toggle action buttons
    callNextBtn.style.display = "none";
    recallBtn.style.display = "inline-flex";
    completeBtn.style.display = "inline-flex";
    missedBtn.style.display = "inline-flex";
}

// Set No Active Token UI
function setNoActiveToken() {
    activeToken = null;
    statusBadge.textContent = "Ready";
    statusBadge.style.background = "rgba(99,102,241,0.15)";
    statusBadge.style.color = "#818cf8";
    
    activeTokenCard.innerHTML = `
        <div class="detail-no-active">No customer currently being served</div>
    `;
    
    // Toggle action buttons
    callNextBtn.style.display = "inline-flex";
    recallBtn.style.display = "none";
    completeBtn.style.display = "none";
    missedBtn.style.display = "none";
}

// Button actions
callNextBtn.addEventListener("click", async () => {
    try {
        const agentEmail = sessionStorage.getItem("userEmail") || "";
        const response = await fetch(`${API_BASE}/api/tokens/call-next?counter_number=${counterNumber}&office_type=${sessionOffice}&agent_email=${encodeURIComponent(agentEmail)}`, {
            method: "POST"
        });
        
        if (response.status === 404) {
            alert("No pending customers in the queue!");
            return;
        }
        
        if (!response.ok) throw new Error("Failed to call next");
        
        const token = await response.json();
        setActiveToken(token);
        refreshQueueState();
    } catch (err) {
        console.error("Error calling next:", err);
    }
});

recallBtn.addEventListener("click", async () => {
    if (!activeToken) return;
    try {
        const response = await fetch(`${API_BASE}/api/tokens/${activeToken.id}/recall?office_type=${sessionOffice}`, {
            method: "POST"
        });
        if (!response.ok) throw new Error("Failed to recall");
        
        recallBtn.textContent = "🔔 Recalled!";
        setTimeout(() => {
            recallBtn.textContent = "Recall";
        }, 1500);
    } catch (err) {
        console.error("Error recalling token:", err);
    }
});

completeBtn.addEventListener("click", async () => {
    if (!activeToken) return;
    try {
        const response = await fetch(`${API_BASE}/api/tokens/${activeToken.id}/status?status=COMPLETED&office_type=${sessionOffice}`, {
            method: "PUT"
        });
        if (!response.ok) throw new Error("Failed to complete token");
        
        setNoActiveToken();
        refreshQueueState();
    } catch (err) {
        console.error("Error completing token:", err);
    }
});

missedBtn.addEventListener("click", async () => {
    if (!activeToken) return;
    try {
        const response = await fetch(`${API_BASE}/api/tokens/${activeToken.id}/status?status=MISSED&office_type=${sessionOffice}`, {
            method: "PUT"
        });
        if (!response.ok) throw new Error("Failed to mark missed");
        
        setNoActiveToken();
        refreshQueueState();
    } catch (err) {
        console.error("Error marking missed:", err);
    }
});

// Setup WebSocket Listener
function setupWebSocket() {
    const socket = new WebSocket(`${WS_BASE}/ws/queue`);
    
    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        // Filter by office type
        if (msg.office_type && msg.office_type !== sessionOffice) {
            return;
        }
        
        if (msg.type === "NEW_TOKEN" || msg.type === "CALL_TOKEN" || msg.type === "UPDATE_STATUS") {
            refreshQueueState();
        } else if (msg.type === "UPDATE_COUNTERS") {
            loadCountersDropdown();
        }
    };
    
    socket.onclose = () => {
        setTimeout(setupWebSocket, 3000);
    };
}

// Start
initAgent();
