// API_BASE and WS_BASE are provided by config.js (loaded before this script)

// Verify Session
const sessionToken = sessionStorage.getItem("userToken");
const sessionRole = sessionStorage.getItem("userRole");
const sessionOffice = sessionStorage.getItem("userOffice") || "BANK";

if (!sessionToken || sessionRole !== "admin") {
    // If not authenticated as admin, kick back to selector page
    window.location.href = "/static/index.html";
}

// DOM Elements - Dashboard KPIs
const kpiTotal = document.getElementById("kpi-total");
const kpiPending = document.getElementById("kpi-pending");
const kpiServing = document.getElementById("kpi-serving");
const kpiCompleted = document.getElementById("kpi-completed");
const kpiMissed = document.getElementById("kpi-missed");
const kpiAvgWait = document.getElementById("kpi-avg-wait");

const officeTypeTag = document.getElementById("office-type-tag");
const tokenTableBody = document.getElementById("token-table-body");
const counterTableBody = document.getElementById("counter-table-body");
const newCounterNumber = document.getElementById("new-counter-number");
const addCounterBtn = document.getElementById("add-counter-btn");

const adminLogoutBtn = document.getElementById("admin-logout-btn");

// Handle Logout Action (local to this tab, does not affect other tabs or centers)
adminLogoutBtn.addEventListener("click", () => {
    sessionStorage.clear();
    window.location.href = "/static/index.html";
});

// Fetch performance KPIs
async function loadMetrics() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/metrics?office_type=${sessionOffice}`);
        const metrics = await response.json();
        
        kpiTotal.textContent = metrics.total_tokens;
        kpiPending.textContent = metrics.pending_count;
        kpiServing.textContent = metrics.serving_count;
        kpiCompleted.textContent = metrics.completed_count;
        kpiMissed.textContent = metrics.missed_count;
        kpiAvgWait.textContent = `${metrics.avg_wait_minutes}m`;
        
    } catch (err) {
        console.error("Error loading admin metrics:", err);
    }
}

// Fetch active tokens list for the table
async function loadTableDetails() {
    try {
        const response = await fetch(`${API_BASE}/api/queues/status?office_type=${sessionOffice}`);
        const status = await response.json();
        
        const allTokens = [...status.active_tokens, ...status.pending_tokens];
        allTokens.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        renderTable(allTokens);
    } catch (err) {
        console.error("Error loading table details:", err);
    }
}

// Render token details in table
function renderTable(tokens) {
    if (tokens.length === 0) {
        tokenTableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-secondary);">No active or pending tokens in the queue.</td>
            </tr>
        `;
        return;
    }
    
    tokenTableBody.innerHTML = "";
    tokens.forEach(token => {
        const tr = document.createElement("tr");
        const statusClass = `badge badge-${token.status.toLowerCase()}`;
        const timeStr = new Date(token.created_at).toLocaleTimeString();
        
        tr.innerHTML = `
            <td style="font-weight: 700; color: var(--accent-primary);">${token.token_number}</td>
            <td>${token.service_name}</td>
            <td style="font-family: monospace;">${token.customer_info || 'Walk-in'}</td>
            <td><span class="${statusClass}">${token.status}</span></td>
            <td style="font-weight: 600;">${token.counter_assigned ? `Counter ${token.counter_assigned}` : '-'}</td>
            <td>${timeStr}</td>
        `;
        tokenTableBody.appendChild(tr);
    });
}

// Load counters dynamically
async function loadCounters() {
    try {
        const response = await fetch(`${API_BASE}/api/counters?office_type=${sessionOffice}`);
        const counters = await response.json();
        renderCountersTable(counters);
    } catch (err) {
        console.error("Error loading counters:", err);
    }
}

function renderCountersTable(counters) {
    if (counters.length === 0) {
        counterTableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; color: var(--text-secondary);">No counters allocated.</td>
            </tr>
        `;
        return;
    }
    counterTableBody.innerHTML = "";
    counters.forEach(counter => {
        const tr = document.createElement("tr");
        const statusBadge = counter.is_active 
            ? '<span class="badge badge-serving">Active</span>' 
            : '<span class="badge badge-missed">Inactive</span>';
            
        const actionButton = counter.is_active
            ? `<button class="btn btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="toggleCounter(${counter.id}, false)">Disable</button>`
            : `<button class="btn btn-success" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="toggleCounter(${counter.id}, true)">Enable</button>`;

        tr.innerHTML = `
            <td style="font-weight: 700;">Counter ${counter.counter_number}</td>
            <td>${statusBadge}</td>
            <td>${actionButton}</td>
        `;
        counterTableBody.appendChild(tr);
    });
}

async function toggleCounter(counterId, status) {
    try {
        const response = await fetch(`${API_BASE}/api/counters/${counterId}/status?is_active=${status}&office_type=${sessionOffice}`, {
            method: "PUT"
        });
        if (!response.ok) throw new Error("Failed to update status");
        loadCounters();
    } catch (err) {
        console.error("Error toggling counter:", err);
    }
}
window.toggleCounter = toggleCounter;

addCounterBtn.addEventListener("click", async () => {
    const num = parseInt(newCounterNumber.value);
    if (!num || num < 1) {
        alert("Enter a valid counter number!");
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/counters?counter_number=${num}&office_type=${sessionOffice}`, {
            method: "POST"
        });
        if (!response.ok) throw new Error("Failed to add counter");
        newCounterNumber.value = "";
        loadCounters();
    } catch (err) {
        console.error(err);
    }
});

// Setup Office Tag on load
async function initHeader() {
    officeTypeTag.textContent = sessionOffice.replace("_", " ");
}

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
            loadMetrics();
            loadTableDetails();
        } else if (msg.type === "UPDATE_COUNTERS") {
            loadCounters();
        }
    };
    
    socket.onclose = () => {
        setTimeout(setupWebSocket, 3000);
    };
}

// Start
initHeader();
loadMetrics();
loadTableDetails();
loadCounters();
setupWebSocket();
