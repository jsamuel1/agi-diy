/**
 * Google API Integration for agi.diy
 * 
 * Provides browser-based access to Google APIs (Gmail, Drive, Calendar, YouTube, etc.)
 * using Google Identity Services (GIS) for OAuth and gapi for API calls.
 * 
 * Features:
 * - OAuth 2.0 authentication flow in browser
 * - Token persistence in localStorage
 * - Universal Google API access via discovery
 * - Support for all Google API operations
 */

// Default comprehensive scopes (same as Python version)
export const DEFAULT_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    // Gmail
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://www.googleapis.com/auth/gmail.modify',
    // Calendar
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    // Drive
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    // Sheets, Docs, Slides
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/presentations',
    // YouTube
    'https://www.googleapis.com/auth/youtube.readonly',
    // Contacts/People
    'https://www.googleapis.com/auth/contacts.readonly',
    // Tasks
    'https://www.googleapis.com/auth/tasks',
];

// Storage keys
const TOKEN_STORAGE_KEY = 'google_oauth_token';
const CONFIG_STORAGE_KEY = 'google_api_config';

/**
 * Google API Manager - handles auth and API calls
 */
export class GoogleAPIManager {
    constructor() {
        this.config = null;
        this.gapiLoaded = false;
        this.gisLoaded = false;
        this.loadConfig();
    }

    /**
     * Load config from localStorage
     */
    loadConfig() {
        const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (stored) {
            try {
                this.config = JSON.parse(stored);
            } catch (e) {
                console.warn('Failed to load Google config:', e);
            }
        }
    }

    /**
     * Save config to localStorage
     */
    saveConfig(config) {
        this.config = config;
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
    }

    /**
     * Get current config
     */
    getConfig() {
        return this.config;
    }

    /**
     * Check if authenticated
     */
    isAuthenticated() {
        const token = this.getStoredToken();
        return token !== null;
    }

    /**
     * Load Google API scripts dynamically
     */
    async loadScripts() {
        // Load gapi (Google API client)
        if (!this.gapiLoaded) {
            await this.loadScript('https://apis.google.com/js/api.js');
            await new Promise((resolve) => {
                window.gapi.load('client', resolve);
            });
            this.gapiLoaded = true;
        }

        // Load GIS (Google Identity Services)
        if (!this.gisLoaded) {
            await this.loadScript('https://accounts.google.com/gsi/client');
            this.gisLoaded = true;
        }
    }

    /**
     * Helper to load a script
     */
    loadScript(src) {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.defer = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }

    /**
     * Get stored token
     */
    getStoredToken() {
        const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
        if (!stored) return null;

        try {
            const token = JSON.parse(stored);
            
            // Check if expired
            if (token.expiry_time && Date.now() > token.expiry_time) {
                console.log('Token expired, clearing...');
                localStorage.removeItem(TOKEN_STORAGE_KEY);
                return null;
            }
            
            return token;
        } catch (e) {
            return null;
        }
    }

    /**
     * Store token
     */
    storeToken(token) {
        // Add expiry time
        token.expiry_time = Date.now() + (token.expires_in * 1000);
        localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
    }

    /**
     * Initialize OAuth client
     */
    async initAuth() {
        if (!this.config?.clientId) {
            console.error('Google Client ID not configured');
            return false;
        }

        await this.loadScripts();

        // Initialize gapi client with API key if available
        if (this.config.apiKey) {
            await window.gapi.client.init({
                apiKey: this.config.apiKey,
            });
        }

        return true;
    }

    /**
     * Request OAuth token (triggers popup)
     */
    async requestToken(scopes) {
        if (!this.config?.clientId) {
            throw new Error('Google Client ID not configured. Set it in settings.');
        }

        await this.loadScripts();

        const effectiveScopes = scopes || this.config.scopes || DEFAULT_SCOPES;

        return new Promise((resolve, reject) => {
            const tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: this.config.clientId,
                scope: effectiveScopes.join(' '),
                callback: (response) => {
                    if (response.error) {
                        reject(new Error(response.error_description || response.error));
                        return;
                    }
                    
                    const token = {
                        access_token: response.access_token,
                        expires_in: response.expires_in,
                        scope: response.scope,
                        token_type: response.token_type,
                    };
                    
                    this.storeToken(token);
                    resolve(token);
                },
                error_callback: (error) => {
                    reject(new Error(error.message || 'OAuth failed'));
                },
            });

            tokenClient.requestAccessToken({ prompt: 'consent' });
        });
    }

    /**
     * Get valid token (from storage or request new)
     */
    async getToken(forceNew = false) {
        if (!forceNew) {
            const stored = this.getStoredToken();
            if (stored) return stored;
        }

        return this.requestToken();
    }

    /**
     * Revoke token and clear storage
     */
    async revokeToken() {
        const token = this.getStoredToken();
        if (token) {
            await this.loadScripts();
            window.google.accounts.oauth2.revoke(token.access_token);
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
    }

    /**
     * Get user info from token
     */
    async getUserInfo() {
        const token = await this.getToken();
        
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${token.access_token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to get user info');
        }

        return response.json();
    }

    /**
     * Execute a Google API call using gapi.client
     */
    async callAPI(service, version, resource, method, parameters = {}, headers = {}) {
        try {
            // Get token
            const token = await this.getToken();
            
            await this.loadScripts();
            
            // Set auth token
            window.gapi.client.setToken({ access_token: token.access_token });

            // Load the API discovery document
            try {
                await window.gapi.client.load(service, version);
            } catch (loadError) {
                // Some APIs don't have discovery docs, try REST fallback
                console.warn(`Could not load ${service} ${version} via discovery, trying REST...`);
                return this.callREST_API(service, version, resource, method, parameters, headers, token);
            }

            // Navigate to the resource
            const resourceParts = resource.split('.');
            let current = window.gapi.client[service];
            
            if (!current) {
                return {
                    status: 'error',
                    error: `Service '${service}' not loaded. Check the service name.`
                };
            }

            for (const part of resourceParts) {
                if (!current[part]) {
                    const available = Object.keys(current).filter(k => !k.startsWith('_'));
                    return {
                        status: 'error',
                        error: `Resource '${part}' not found in '${service}' API.\nAvailable: ${available.join(', ')}`
                    };
                }
                current = current[part];
            }

            // Get the method
            if (typeof current[method] !== 'function') {
                const available = Object.keys(current).filter(k => typeof current[k] === 'function');
                return {
                    status: 'error',
                    error: `Method '${method}' not found.\nAvailable: ${available.join(', ')}`
                };
            }

            // Execute the call
            const response = await current[method](parameters);

            return {
                status: 'success',
                data: response.result
            };

        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Fallback REST API call for APIs without discovery docs
     */
    async callREST_API(service, version, resource, method, parameters, headers, token) {
        // Build REST URL based on service
        const baseUrls = {
            'gmail': 'https://gmail.googleapis.com',
            'drive': 'https://www.googleapis.com/drive',
            'calendar': 'https://www.googleapis.com/calendar',
            'youtube': 'https://www.googleapis.com/youtube',
            'sheets': 'https://sheets.googleapis.com',
            'docs': 'https://docs.googleapis.com',
            'slides': 'https://slides.googleapis.com',
            'tasks': 'https://tasks.googleapis.com',
            'people': 'https://people.googleapis.com',
        };

        const baseUrl = baseUrls[service] || `https://${service}.googleapis.com`;
        
        // Build path from resource
        const path = resource.replace(/\./g, '/');
        let url = `${baseUrl}/${version}/${path}`;

        // Handle method mapping
        const httpMethod = {
            'list': 'GET',
            'get': 'GET',
            'create': 'POST',
            'insert': 'POST',
            'update': 'PUT',
            'patch': 'PATCH',
            'delete': 'DELETE',
            'send': 'POST',
        }[method] || 'GET';

        // Handle parameters
        let body = null;
        const queryParams = new URLSearchParams();

        for (const [key, value] of Object.entries(parameters)) {
            if (key === 'body') {
                body = value;
            } else if (typeof value === 'object') {
                queryParams.set(key, JSON.stringify(value));
            } else {
                queryParams.set(key, String(value));
            }
        }

        if (queryParams.toString()) {
            url += '?' + queryParams.toString();
        }

        const response = await fetch(url, {
            method: httpMethod,
            headers: {
                'Authorization': `Bearer ${token.access_token}`,
                'Content-Type': 'application/json',
                ...headers
            },
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { message: errorText };
            }
            return {
                status: 'error',
                error: errorData.error?.message || errorData.message || `HTTP ${response.status}`
            };
        }

        const data = await response.json();
        return {
            status: 'success',
            data
        };
    }

    /**
     * Make a raw REST API call
     */
    async callREST(url, method = 'GET', body, headers = {}) {
        try {
            const token = await this.getToken();

            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${token.access_token}`,
                    'Content-Type': 'application/json',
                    ...headers
                },
                body: body ? JSON.stringify(body) : undefined
            });

            if (!response.ok) {
                const error = await response.text();
                return {
                    status: 'error',
                    error: `HTTP ${response.status}: ${error}`
                };
            }

            const data = await response.json();
            return {
                status: 'success',
                data
            };

        } catch (error) {
            return {
                status: 'error',
                error: error.message || String(error)
            };
        }
    }

    /**
     * Handle API errors with helpful messages
     */
    handleError(error) {
        const errorMsg = error.result?.error?.message || error.message || String(error);
        
        if (errorMsg.includes('quota')) {
            return {
                status: 'error',
                error: `API quota exceeded. Wait and try again.\n\nDetails: ${errorMsg}`
            };
        }
        
        if (errorMsg.includes('permission') || errorMsg.includes('forbidden') || errorMsg.includes('403')) {
            return {
                status: 'error',
                error: `Permission denied. You may need additional OAuth scopes.\n\nDetails: ${errorMsg}`
            };
        }
        
        if (errorMsg.includes('401') || errorMsg.includes('invalid_token') || errorMsg.includes('unauthenticated')) {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            return {
                status: 'error',
                error: `Authentication expired. Please re-authenticate using google_auth tool.\n\nDetails: ${errorMsg}`
            };
        }

        if (errorMsg.includes('not found') || errorMsg.includes('404')) {
            return {
                status: 'error',
                error: `Resource not found. Check your parameters and IDs.\n\nDetails: ${errorMsg}`
            };
        }

        return {
            status: 'error',
            error: errorMsg
        };
    }
}

// Global instance
export const googleAPI = new GoogleAPIManager();

// Expose to window for debugging
window.googleAPI = googleAPI;
