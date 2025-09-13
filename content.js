// Content script for LeetCode GitHub Sync Extension
class LeetCodeContentScript {
    constructor() {
        this.init();
    }

    init() {
        // Wait for page to load
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupUI());
        } else {
            this.setupUI();
        }

        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open
        });
    }

    setupUI() {
        // Only add UI on submission pages
        if (!window.location.href.includes('/submissions/')) {
            return;
        }

        this.createPushButton();
        this.observePageChanges();
    }

    createPushButton() {
        // Remove existing button if present
        const existingButton = document.getElementById('leetcode-github-sync-btn');
        if (existingButton) {
            existingButton.remove();
        }

        // Create the push button
        const button = document.createElement('button');
        button.id = 'leetcode-github-sync-btn';
        button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Push to GitHub
        `;
        button.className = 'leetcode-github-sync-button';
        
        button.addEventListener('click', () => this.handlePushClick());

        // Find the best location to insert the button
        this.insertButton(button);
    }

    insertButton(button) {
        // Try multiple selectors to find the best location
        const selectors = [
            '[data-cy="submission-header"]',
            '.submission-header',
            '.flex.items-center.justify-between',
            '.mb-4.flex.items-center.justify-between',
            'h1'
        ];

        let inserted = false;
        for (const selector of selectors) {
            const target = document.querySelector(selector);
            if (target) {
                const container = document.createElement('div');
                container.className = 'leetcode-github-sync-container';
                container.appendChild(button);
                
                target.parentNode.insertBefore(container, target.nextSibling);
                inserted = true;
                break;
            }
        }

        // Fallback: add to body if no suitable location found
        if (!inserted) {
            const container = document.createElement('div');
            container.className = 'leetcode-github-sync-container fallback';
            container.appendChild(button);
            document.body.appendChild(container);
        }
    }

    async handlePushClick() {
        const button = document.getElementById('leetcode-github-sync-btn');
        if (!button) return;

        // Disable button and show loading
        button.disabled = true;
        const originalContent = button.innerHTML;
        button.innerHTML = `
            <div class="spinner"></div>
            Pushing...
        `;

        try {
            // Send message to background script to push solution
            const response = await chrome.runtime.sendMessage({
                action: 'pushSolution',
                settings: await this.getSettings()
            });

            if (response.success) {
                this.showNotification('✅ Solution pushed to GitHub successfully!', 'success');
                button.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                    Pushed!
                `;
                
                setTimeout(() => {
                    button.innerHTML = originalContent;
                    button.disabled = false;
                }, 3000);
            } else {
                throw new Error(response.error || 'Failed to push solution');
            }
        } catch (error) {
            console.error('Push error:', error);
            this.showNotification(`❌ Error: ${error.message}`, 'error');
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }

    async getSettings() {
        try {
            const result = await chrome.storage.sync.get(['settings']);
            return result.settings || {
                repoName: 'leetcode-solutions',
                repoDescription: 'My LeetCode solutions with AI analysis',
                aiFeatures: {
                    complexity: true,
                    optimization: true,
                    alternatives: false
                }
            };
        } catch (error) {
            console.error('Error getting settings:', error);
            return {
                repoName: 'leetcode-solutions',
                repoDescription: 'My LeetCode solutions with AI analysis',
                aiFeatures: {
                    complexity: true,
                    optimization: true,
                    alternatives: false
                }
            };
        }
    }

    showNotification(message, type = 'info') {
        // Remove existing notifications
        const existing = document.querySelectorAll('.leetcode-github-sync-notification');
        existing.forEach(el => el.remove());

        // Create notification
        const notification = document.createElement('div');
        notification.className = `leetcode-github-sync-notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <span>${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    observePageChanges() {
        // Watch for navigation changes (SPA)
        let currentUrl = window.location.href;
        
        const observer = new MutationObserver(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                setTimeout(() => this.setupUI(), 1000); // Delay to ensure page is loaded
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    handleMessage(request, sender, sendResponse) {
        switch (request.action) {
            case 'extractData':
                this.extractSubmissionData().then(sendResponse);
                break;
            
            case 'checkPage':
                sendResponse({
                    isSubmissionPage: window.location.href.includes('/submissions/'),
                    url: window.location.href
                });
                break;
                
            default:
                sendResponse({ error: 'Unknown action' });
        }
    }

    async extractSubmissionData() {
        try {
            // This function runs in the page context and extracts data
            // The actual extraction logic is in the background script's extractPageData function
            return { success: true, message: 'Data extraction handled by background script' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Initialize content script
new LeetCodeContentScript();