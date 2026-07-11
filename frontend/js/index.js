const selector = document.getElementById("hub-office-selector");
const proceedBtn = document.getElementById("proceed-btn");

// Proceed to login page with selection in URL
proceedBtn.addEventListener("click", () => {
    const selectedOffice = selector.value;
    window.location.href = `/static/login.html?center=${selectedOffice}`;
});
