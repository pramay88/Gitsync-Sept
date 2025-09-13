// popup.js - Extension popup functionality
class PopupController {
    constructor() {
        this.initializeElements();
        this.setupEventListeners();
        this.checkAuthStatus();
    }

    initializeElements() {
        this.elements = {
            status: document.getElementById('status'),
            userInfo: document.getElementById('user-info'),
            userAvatar: document.getElementById('user-avatar'),
            userName: document.getElementById('user-name'),
            userLogin: document.getElementById('user-login'),
            authBtn: document.getElementById('auth-btn'),
            syncBtn: document.getElementById('sync-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            logoutBtn: document.getElementById('logout-btn')
        };
    }

    setupEventListeners() {
        this.elements.authBtn.addEventListener('click', () => this.handleAuth());
        this.elements.syncBtn.addEventListener('click', () => this.handleSync());
        this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
        this.elements.logoutBtn.addEventListener('click', () => this.handleLogout());
    }

    async checkAuthStatus() {
        try {
            this.showLoading();
            const response = await this.sendMessage({ action: 'checkAuth' });
            
            if (response.success && response.authenticated) {
                this.showAuthenticated(response.user);
            } else {
                this.showUnauthenticated();
            }
        } catch (error) {
            console.error('Auth status check failed:', error);
            this.showError('Failed to check authentication status');
            this.showUnauthenticated();
        }
    }

    async handleAuth() {
        try {
            this.showLoading('Connecting to GitHub...');
            this.elements.authBtn.disabled = true;
            
            const response = await this.sendMessage({ action: 'authenticate' });
            
            if (response.success) {
                this.showSuccess('Successfully connected to GitHub!');
                this.showAuthenticated(response.user);
            } else {
                this.showError(response.error || 'Authentication failed');
                this.showUnauthenticated();
            }
        } catch (error) {
            console.error('Authentication error:', error);
            this.showError('Authentication failed. Please try again.');
            this.showUnauthenticated();
        } finally {
            this.elements.authBtn.disabled = false;
        }
    }

    async handleSync() {
        try {
            // First check if we're on a LeetCode page
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('leetcode.com')) {
                this.showError('Please navigate to a LeetCode page first');
                return;
            }

            this.showLoading('Syncing solution...');
            this.elements.syncBtn.disabled = true;

            // Get settings first
            const settings = await this.getSettings();
            
            const response = await this.sendMessage({ 
                action: 'pushSolution',
                settings: settings
            });
            
            if (response.success) {
                this.showSuccess(`Solution synced successfully! File: ${response.fileName}`);
            } else {
                this.showError(response.error || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync error:', error);
            this.showError('Sync failed. Please try again.');
        } finally {
            this.elements.syncBtn.disabled = false;
        }
    }

    async handleLogout() {
        try {
            this.showLoading('Disconnecting...');
            
            const response = await this.sendMessage({ action: 'logout' });
            
            if (response.success) {
                this.showSuccess('Successfully disconnected');
                this.showUnauthenticated();
            } else {
                this.showError('Logout failed');
            }
        } catch (error) {
            console.error('Logout error:', error);
            this.showError('Logout failed');
        }
    }

    openSettings() {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
        window.close();
    }

    async getSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['settings'], (result) => {
                const defaultSettings = {
                    repoName: 'leetcode-solutions',
                    repoDescription: 'My LeetCode solutions with AI analysis',
                    aiFeatures: {
                        complexity: true,
                        optimization: true,
                        alternatives: false
                    },
                    autoSync: false,
                    includeDescription: true,
                    includeHints: true
                };
                
                resolve(result.settings || defaultSettings);
            });
        });
    }

    showAuthenticated(user) {
        // Show user info
        this.elements.userInfo.classList.remove('hidden');
        this.elements.userAvatar.src = user.avatar_url || '';
        this.elements.userName.textContent = user.name || user.login;
        this.elements.userLogin.textContent = `@${user.login}`;
        
        // Show authenticated buttons
        this.elements.authBtn.classList.add('hidden');
        this.elements.syncBtn.classList.remove('hidden');
        this.elements.settingsBtn.classList.remove('hidden');
        this.elements.logoutBtn.classList.remove('hidden');
        
        this.clearStatus();
    }

    showUnauthenticated() {
        // Hide user info
        this.elements.userInfo.classList.add('hidden');
        
        // Show auth button, hide others
        this.elements.authBtn.classList.remove('hidden');
        this.elements.syncBtn.classList.add('hidden');
        this.elements.settingsBtn.classList.add('hidden');
        this.elements.logoutBtn.classList.add('hidden');
        
        this.clearStatus();
    }

    showLoading(message = 'Loading...') {
        this.elements.status.className = 'status status-info';
        this.elements.status.textContent = message;
        this.elements.status.classList.remove('hidden');
        document.body.classList.add('loading');
    }

    showSuccess(message) {
        this.elements.status.className = 'status status-success';
        this.elements.status.textContent = message;
        this.elements.status.classList.remove('hidden');
        document.body.classList.remove('loading');
        
        // Auto-hide success messages after 3 seconds
        setTimeout(() => this.clearStatus(), 3000);
    }

    showError(message) {
        this.elements.status.className = 'status status-error';
        this.elements.status.textContent = message;
        this.elements.status.classList.remove('hidden');
        document.body.classList.remove('loading');
        
        // Auto-hide error messages after 5 seconds
        setTimeout(() => this.clearStatus(), 5000);
    }

    clearStatus() {
        this.elements.status.classList.add('hidden');
        document.body.classList.remove('loading');
    }

    sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || { success: false, error: 'No response received' });
                }
            });
        });
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});