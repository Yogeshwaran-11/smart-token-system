// API_BASE and WS_BASE are provided by config.js (loaded before this script)

// Verify Session
const sessionToken = sessionStorage.getItem("userToken");
const sessionRole = sessionStorage.getItem("userRole");
const sessionOffice = sessionStorage.getItem("userOffice") || "BANK";

if (!sessionToken || sessionRole !== "tv") {
    window.location.href = "/static/index.html";
}

let voiceEnabled = false;

// DOM Elements
const activeGrid = document.getElementById("active-calls-grid");
const waitingList = document.getElementById("waiting-list");
const officeTypeTag = document.getElementById("office-type-tag");
const enableAudioBtn = document.getElementById("enable-audio-btn");
const liveTime = document.getElementById("live-time");
const tvLogoutBtn = document.getElementById("tv-logout-btn");

// Clock
setInterval(() => {
    liveTime.textContent = new Date().toLocaleTimeString();
}, 1000);

// Logout Action
tvLogoutBtn.addEventListener("click", () => {
    sessionStorage.clear();
    window.location.href = "/static/index.html";
});

// Toggle Voice
enableAudioBtn.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    if (voiceEnabled) {
        enableAudioBtn.textContent = "🔊 Voice Enabled";
        enableAudioBtn.className = "btn btn-success";
        announce("Voice announcement system active");
    } else {
        enableAudioBtn.textContent = "🔇 Enable Voice";
        enableAudioBtn.className = "btn btn-warning";
    }
});

// Load Initial Data
async function loadQueueData() {
    try {
        const response = await fetch(`${API_BASE}/api/queues/status?office_type=${sessionOffice}`);
        const status = await response.json();
        
        officeTypeTag.textContent = sessionOffice.replace("_", " ");

        renderActiveCalls(status.active_tokens);
        renderWaitingList(status.pending_tokens);
    } catch (err) {
        console.error("Error loading queue data:", err);
    }
}

// Render Active Called Tokens
function renderActiveCalls(activeTokens) {
    if (activeTokens.length === 0) {
        activeGrid.innerHTML = `
            <div style="grid-column: 1/-1; display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">
                No counters active. Waiting for staff logins...
            </div>
        `;
        return;
    }
    
    activeGrid.innerHTML = "";
    activeTokens.forEach(token => {
        const card = document.createElement("div");
        card.id = `call-card-${token.token_number}`;
        card.className = "call-card glass-container";
        card.innerHTML = `
            <div class="call-card-token">${token.token_number}</div>
            <div class="call-card-counter">Counter ${token.counter_assigned}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem; text-align: center; text-transform: uppercase;">
                ${token.service_name}
            </div>
        `;
        activeGrid.appendChild(card);
    });
}

// Render Waiting List
function renderWaitingList(pendingTokens) {
    if (pendingTokens.length === 0) {
        waitingList.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">
                No pending tokens.
            </div>
        `;
        return;
    }
    
    waitingList.innerHTML = "";
    pendingTokens.forEach(token => {
        const item = document.createElement("div");
        item.className = "waiting-item glass-container";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        
        const estMinutes = token.estimated_wait_minutes !== null && token.estimated_wait_minutes !== undefined 
            ? `~${Math.round(token.estimated_wait_minutes)}m` 
            : "--";
            
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 1rem;">
                <span class="waiting-item-token">${token.token_number}</span>
                <span class="waiting-item-service">${token.service_name}</span>
            </div>
            <span style="font-size: 0.85rem; font-weight: 700; color: var(--accent-warning); background: rgba(245, 158, 11, 0.1); padding: 0.25rem 0.5rem; border-radius: 4px;">
                ⏱️ ${estMinutes}
            </span>
        `;
        waitingList.appendChild(item);
    });
}

// Speak token calls out loud
function announce(text) {
    if (!voiceEnabled) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    
    const voices = window.speechSynthesis.getVoices();
    const defaultVoice = voices.find(v => v.lang.includes("en-US") || v.lang.includes("en-GB"));
    if (defaultVoice) {
        utterance.voice = defaultVoice;
    }
    window.speechSynthesis.speak(utterance);
}

// Flash specific counter card
function triggerVisualFlash(tokenNumber) {
    const card = document.getElementById(`call-card-${tokenNumber}`);
    if (card) {
        card.classList.add("flashing");
        setTimeout(() => {
            card.classList.remove("flashing");
        }, 5000);
    }
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
        
        if (msg.type === "NEW_TOKEN") {
            loadQueueData();
        } else if (msg.type === "CALL_TOKEN") {
            const token = msg.data;
            loadQueueData().then(() => {
                triggerVisualFlash(token.token_number);
                const announcementText = `Token number ${token.token_number.split('').join(' ')}, please proceed to counter ${token.counter_assigned}`;
                announce(announcementText);
            });
        } else if (msg.type === "UPDATE_STATUS") {
            loadQueueData();
        }
    };
    
    socket.onclose = () => {
        setTimeout(setupWebSocket, 3000);
    };
}

// Start
loadQueueData();
setupWebSocket();
