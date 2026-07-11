// ===================================================================
// SMART TOKEN SYSTEM — API Configuration
// ===================================================================
// This file centralizes the backend API URL for all frontend pages.
//
// FOR LOCAL DEVELOPMENT:
//   Leave BACKEND_URL as empty string '' — it will auto-detect.
//
// FOR PRODUCTION (Vercel → Render):
//   Set BACKEND_URL to your Render backend URL, e.g.:
//   const BACKEND_URL = 'https://smart-token-backend.onrender.com';
// ===================================================================

const BACKEND_URL = 'https://smart-token-backend.onrender.com';  // <-- UPDATE THIS AFTER RENDER DEPLOYMENT

// ===================================================================
// Computed values — do NOT modify below this line
// ===================================================================
const API_BASE = BACKEND_URL || window.location.origin;
const WS_BASE = BACKEND_URL
    ? BACKEND_URL.replace(/^http/, 'ws')
    : window.location.origin.replace(/^http/, 'ws');
