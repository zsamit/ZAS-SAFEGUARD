// Welcome page script - TOS Agreement Flow
(function () {
    var checkbox = document.getElementById('agreeCheckbox');
    var btn = document.getElementById('continueBtn');

    // Enable/disable button based on checkbox
    function updateButton() {
        if (checkbox.checked) {
            btn.classList.remove('btn-disabled');
        } else {
            btn.classList.add('btn-disabled');
        }
    }

    // Add listeners
    checkbox.addEventListener('click', updateButton);
    checkbox.addEventListener('change', updateButton);

    // Button click handler
    btn.addEventListener('click', function (e) {
        e.preventDefault();

        if (!checkbox.checked) {
            alert('Please check the box to agree to the Terms of Service and Privacy Policy');
            return false;
        }

        btn.textContent = 'Setting up...';
        btn.classList.add('btn-disabled');

        // Save agreement
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({
                tosAgreed: true,
                tosAgreedAt: new Date().toISOString()
            }, function () {
                // Notify background and redirect to trial/checkout page
                chrome.runtime.sendMessage({ type: 'TOS_AGREED' });
                window.location.href = 'https://zassafeguard.com/app/checkout?plan=monthly&source=extension';
            });
        } else {
            // Not in extension context - redirect anyway
            window.location.href = 'https://zassafeguard.com/app/checkout?plan=monthly&source=extension';
        }
    });
})();
