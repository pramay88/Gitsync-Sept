// gitsync/background.js - Fixed OAuth handling following Chrome's official guidelines
class BackgroundService {
    constructor() {
        this.setupEventListeners();
        // Use the GitHub OAuth App Client ID (not Google's)
        this.githubClientId = 'Ov23li2KzaXJqydhdmob';
        this.githubClientSecret = 'f929f2c3bb445e0cbe87a876adacdc8044e5c671'; // This should be in your backend
        this.redirectUri = chrome.identity.getRedirectURL();
        
        console.log('Extension ID:', chrome.runtime.id);
        console.log('OAuth Redirect URI:', this.redirectUri);
    }

    setupEventListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });

        chrome.action.onClicked.addListener((tab) => {
            if (tab.url.includes('leetcode.com')) {
                chrome.action.openPopup();
            } else {
                chrome.tabs.create({url: 'index.html'});
            }
        });
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'authenticate':
                    const authResult = await this.authenticateWithGitHub();
                    sendResponse(authResult);
                    break;

                case 'logout':
                    const logoutResult = await this.logout();
                    sendResponse(logoutResult);
                    break;

                case 'checkAuth':
                    const authStatus = await this.checkAuthStatus();
                    sendResponse(authStatus);
                    break;

                case 'pushSolution':
                    const pushResult = await this.pushSolutionToGitHub(request.settings);
                    sendResponse(pushResult);
                    break;

                case 'extractData':
                    const extractResult = await this.extractLeetCodeData();
                    sendResponse(extractResult);
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Background service error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async checkAuthStatus() {
        try {
            const result = await chrome.storage.sync.get(['githubToken', 'githubUser']);
            if (result.githubToken && result.githubUser) {
                // Verify token is still valid
                const response = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${result.githubToken}`,
                        'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                    }
                });

                if (response.ok) {
                    return { 
                        success: true, 
                        authenticated: true, 
                        user: result.githubUser 
                    };
                } else {
                    // Token is invalid, clear it
                    await chrome.storage.sync.remove(['githubToken', 'githubUser']);
                    return { 
                        success: true, 
                        authenticated: false 
                    };
                }
            }
            return { 
                success: true, 
                authenticated: false 
            };
        } catch (error) {
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    async logout() {
        try {
            await chrome.storage.sync.remove(['githubToken', 'githubUser']);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async authenticateWithGitHub() {
        try {
            // First check if already authenticated
            const authStatus = await this.checkAuthStatus();
            if (authStatus.authenticated) {
                return { 
                    success: true, 
                    user: authStatus.user,
                    message: 'Already authenticated'
                };
            }

            // Clear any cached auth tokens before starting
            await chrome.identity.clearAllCachedAuthTokens();
            
            const redirectURL = chrome.identity.getRedirectURL();
            console.log('OAuth Redirect URL:', redirectURL);
            
            // GitHub OAuth URL with proper scopes
            const authURL = new URL('https://github.com/login/oauth/authorize');
            authURL.searchParams.set('client_id', this.githubClientId);
            authURL.searchParams.set('redirect_uri', redirectURL);
            authURL.searchParams.set('scope', 'repo user:email');
            authURL.searchParams.set('state', this.generateStateToken());
            
            console.log('Starting OAuth flow with URL:', authURL.toString());
            
            // Launch OAuth flow
            const responseUrl = await new Promise((resolve, reject) => {
                chrome.identity.launchWebAuthFlow({
                    url: authURL.toString(),
                    interactive: true
                }, (responseUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error('OAuth flow error:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (!responseUrl) {
                        reject(new Error('OAuth flow was cancelled by user'));
                    } else {
                        console.log('OAuth response URL received:', responseUrl);
                        resolve(responseUrl);
                    }
                });
            });

            // Parse the response URL
            const url = new URL(responseUrl);
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const state = url.searchParams.get('state');
            
            if (error) {
                throw new Error(`OAuth error: ${error} - ${url.searchParams.get('error_description')}`);
            }
            
            if (!code) {
                throw new Error('No authorization code received from GitHub');
            }
            
            console.log('Authorization code received, exchanging for token...');
            
            // Exchange code for token
            return await this.exchangeCodeForToken(code);
            
        } catch (error) {
            console.error('GitHub authentication error:', error);
            return { 
                success: false, 
                error: error.message || 'Authentication failed' 
            };
        }
    }

    generateStateToken() {
        // Generate a random state token for CSRF protection
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        return array[0].toString();
    }

    async exchangeCodeForToken(code) {
        try {
            console.log('Exchanging authorization code for access token...');
            
            const response = await fetch('https://gitsync-sept-gitoauth.vercel.app/api/auth/github', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ code })
            });

            console.log('Token exchange response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Token exchange failed:', response.status, errorText);
                throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
            }

            const tokenData = await response.json();
            console.log('Token exchange response received');
            
            if (!tokenData.access_token) {
                console.error('No access token in response:', tokenData);
                throw new Error(tokenData.error || 'Failed to receive access token');
            }

            console.log('Access token received, fetching user information...');
            
            // Get user information
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `token ${tokenData.access_token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                }
            });

            if (!userResponse.ok) {
                const userError = await userResponse.text();
                console.error('Failed to fetch user info:', userError);
                throw new Error(`Failed to fetch user information: ${userResponse.status}`);
            }

            const user = await userResponse.json();
            console.log('User information fetched successfully for:', user.login);

            // Store authentication data
            await chrome.storage.sync.set({
                githubToken: tokenData.access_token,
                githubUser: {
                    id: user.id,
                    login: user.login,
                    name: user.name,
                    email: user.email,
                    avatar_url: user.avatar_url,
                    html_url: user.html_url
                },
                tokenScope: tokenData.scope,
                authenticatedAt: Date.now()
            });

            console.log('Authentication completed successfully');

            return { 
                success: true, 
                user: user,
                message: 'Successfully authenticated with GitHub'
            };

        } catch (error) {
            console.error('Token exchange error:', error);
            return { 
                success: false, 
                error: error.message || 'Failed to exchange token'
            };
        }
    }

    // Rest of the methods remain largely the same, with improved error handling
    async pushSolutionToGitHub(settings) {
        try {
            // Check authentication
            const authStatus = await this.checkAuthStatus();
            if (!authStatus.authenticated) {
                throw new Error('Not authenticated with GitHub. Please authenticate first.');
            }

            const result = await chrome.storage.sync.get(['githubToken', 'githubUser']);
            
            // Extract LeetCode data from current tab
            console.log('Extracting LeetCode data...');
            const leetcodeData = await this.extractLeetCodeData();
            if (!leetcodeData.success) {
                throw new Error(leetcodeData.error);
            }

            console.log('LeetCode data extracted successfully');

            // Ensure repository exists
            console.log('Ensuring repository exists...');
            await this.ensureRepositoryExists(result.githubToken, result.githubUser.login, settings);

            // Generate solution file content
            console.log('Generating solution file...');
            const fileContent = await this.generateSolutionFile(leetcodeData.data, settings);

            // Create/update file in repository
            const fileName = this.generateFileName(leetcodeData.data);
            console.log('Creating/updating file:', fileName);
            
            await this.createOrUpdateFile(
                result.githubToken,
                result.githubUser.login,
                settings.repoName,
                fileName,
                fileContent,
                leetcodeData.data
            );

            console.log('Solution pushed successfully');

            return { 
                success: true, 
                fileName,
                message: 'Solution pushed to GitHub successfully'
            };
        } catch (error) {
            console.error('Push solution error:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    async extractLeetCodeData() {
        try {
            // Get active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('No active tab found');
            }
            
            if (!tab.url.includes('leetcode.com')) {
                throw new Error('Please navigate to a LeetCode page');
            }

            if (!tab.url.includes('submissions') && !tab.url.includes('problems')) {
                throw new Error('Please navigate to a LeetCode problem or submission page');
            }

            // Inject content script to extract data
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: this.extractPageData
            });

            if (results && results[0] && results[0].result) {
                const data = results[0].result;
                
                // Get AI analysis if enabled
                const settings = await chrome.storage.sync.get(['settings']);
                if (settings.settings && settings.settings.aiFeatures) {
                    console.log('Getting AI analysis...');
                    data.aiAnalysis = await this.getAIAnalysis(data.code, settings.settings.aiFeatures);
                }

                return { success: true, data };
            } else {
                throw new Error('Failed to extract LeetCode data from page');
            }
        } catch (error) {
            console.error('Extract data error:', error);
            return { success: false, error: error.message };
        }
    }

    // Enhanced page data extraction function
    extractPageData() {
        return new Promise(async (resolve, reject) => {
            try {
                // Wait for page to be fully loaded
                if (document.readyState !== 'complete') {
                    await new Promise(resolve => {
                        window.addEventListener('load', resolve);
                    });
                }

                // Check if we're on a submission page
                const isSubmissionPage = window.location.pathname.includes('submissions');
                const isProblemPage = window.location.pathname.includes('problems');
                
                if (!isSubmissionPage && !isProblemPage) {
                    throw new Error('Not on a LeetCode problem or submission page');
                }

                // Extract problem slug from URL
                const pathParts = window.location.pathname.split('/');
                const problemSlug = pathParts[2] || pathParts[pathParts.indexOf('problems') + 1];
                
                if (!problemSlug) {
                    throw new Error('Could not determine problem slug from URL');
                }

                console.log('Extracting data for problem:', problemSlug);

                // Function to make GraphQL requests with retry
                const makeGraphQLRequest = async (operationName, query, variables = {}, retries = 3) => {
                    for (let i = 0; i < retries; i++) {
                        try {
                            const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value || 
                                            document.querySelector('meta[name=csrf-token]')?.content || '';

                            const response = await fetch('https://leetcode.com/graphql/', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-CSRFToken': csrfToken,
                                    'Referer': window.location.href
                                },
                                credentials: 'same-origin',
                                body: JSON.stringify({
                                    operationName,
                                    query,
                                    variables
                                })
                            });

                            if (!response.ok) {
                                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                            }

                            return await response.json();
                        } catch (error) {
                            console.error(`GraphQL request attempt ${i + 1} failed:`, error);
                            if (i === retries - 1) throw error;
                            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                        }
                    }
                };

                // Get question details first
                const questionQuery = `
                    query questionDetail($titleSlug: String!) {
                        question(titleSlug: $titleSlug) {
                            title
                            titleSlug
                            questionId
                            questionFrontendId
                            difficulty
                            content
                            stats
                            topicTags {
                                name
                                slug
                            }
                            exampleTestcaseList
                            hints
                            codeSnippets {
                                lang
                                langSlug
                                code
                            }
                        }
                    }
                `;

                console.log('Fetching question details...');
                const questionData = await makeGraphQLRequest('questionDetail', questionQuery, {
                    titleSlug: problemSlug
                });

                if (!questionData.data || !questionData.data.question) {
                    throw new Error('Failed to fetch question details');
                }

                const question = questionData.data.question;
                let submission = null;
                let submissionCode = '';

                // If on submission page, get submission details
                if (isSubmissionPage) {
                    const submissionId = pathParts[pathParts.length - 1];
                    
                    if (submissionId && !isNaN(submissionId)) {
                        const submissionQuery = `
                            query submissionDetails($submissionId: Int!) {
                                submissionDetails(submissionId: $submissionId) {
                                    runtime
                                    runtimeDisplay
                                    runtimePercentile
                                    memory
                                    memoryDisplay
                                    memoryPercentile
                                    code
                                    timestamp
                                    statusCode
                                    lang {
                                        name
                                        verboseName
                                    }
                                    question {
                                        questionId
                                        titleSlug
                                    }
                                }
                            }
                        `;

                        console.log('Fetching submission details...');
                        const submissionData = await makeGraphQLRequest('submissionDetails', submissionQuery, {
                            submissionId: parseInt(submissionId)
                        });

                        if (submissionData.data && submissionData.data.submissionDetails) {
                            submission = submissionData.data.submissionDetails;
                            submissionCode = submission.code;
                        }
                    }
                }

                // If no submission code, try to get from code editor on problem page
                if (!submissionCode) {
                    // Try to find code in various editor formats
                    const codeEditors = [
                        '.CodeMirror textarea',
                        '.ace_text-input',
                        '#editor textarea',
                        '.monaco-editor textarea',
                        '[data-cy="code-editor"] textarea'
                    ];

                    for (const selector of codeEditors) {
                        const editor = document.querySelector(selector);
                        if (editor && editor.value.trim()) {
                            submissionCode = editor.value.trim();
                            break;
                        }
                    }

                    // If still no code, use default template
                    if (!submissionCode && question.codeSnippets && question.codeSnippets.length > 0) {
                        submissionCode = question.codeSnippets[0].code;
                    }
                }

                // Parse stats for acceptance rate
                const stats = JSON.parse(question.stats);
                const acceptanceRate = ((stats.acSubmissionNum[0].count / stats.totalSubmissionNum[0].count) * 100).toFixed(1);

                // Parse content for examples and constraints
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = question.content;
                
                const examples = [];
                const exampleElements = tempDiv.querySelectorAll('pre');
                exampleElements.forEach(el => {
                    if (el.textContent.includes('Input:') || el.textContent.includes('Output:')) {
                        examples.push(el.textContent.trim());
                    }
                });

                // Extract constraints
                const constraintsList = tempDiv.querySelectorAll('ul li, ol li');
                const constraints = Array.from(constraintsList)
                    .map(li => li.textContent.trim())
                    .filter(text => text.length > 0);

                // Get plain text description
                const description = tempDiv.textContent.trim()
                    .replace(/\s+/g, ' ')
                    .replace(/Example \d+:.*?(?=Example \d+:|Constraints:|$)/gs, '')
                    .replace(/Constraints:.*$/s, '')
                    .trim();

                // Build result object
                const result = {
                    title: question.title,
                    titleSlug: question.titleSlug,
                    questionId: question.questionFrontendId,
                    difficulty: question.difficulty,
                    description: description,
                    examples: examples,
                    constraints: constraints,
                    topicTags: question.topicTags.map(tag => tag.name),
                    acceptanceRate: acceptanceRate + '%',
                    hints: question.hints || [],
                    code: submissionCode,
                    
                    // Default values if no submission
                    language: submission ? submission.lang.verboseName : 'Unknown',
                    langSlug: submission ? submission.lang.name : 'unknown',
                    runtime: submission ? submission.runtimeDisplay : 'N/A',
                    runtimePercentile: submission ? submission.runtimePercentile : null,
                    memory: submission ? submission.memoryDisplay : 'N/A',
                    memoryPercentile: submission ? submission.memoryPercentile : null,
                    timestamp: submission ? new Date(submission.timestamp * 1000).toISOString() : new Date().toISOString(),
                    
                    beats: {
                        runtime: submission ? submission.runtimePercentile : null,
                        memory: submission ? submission.memoryPercentile : null
                    }
                };

                console.log('Data extraction completed successfully');
                resolve(result);

            } catch (error) {
                console.error('Page data extraction error:', error);
                reject(error);
            }
        });
    }

    async getAIAnalysis(code, features) {
        const analysis = {};

        try {
            if ((features.complexity || features.optimization) && code.trim()) {
                console.log('Getting AI complexity analysis...');
                const response = await fetch('https://code-analyzer-six.vercel.app/api/analyze', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        code: code.trim(),
                        language: 'auto-detect'
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    
                    if (features.complexity) {
                        analysis.complexity = {
                            time: data.timeComplexity || 'Analysis unavailable',
                            space: data.spaceComplexity || 'Analysis unavailable',
                            explanation: data.explanation || ''
                        };
                    }

                    if (features.optimization) {
                        analysis.optimizations = data.optimizations || [];
                        analysis.suggestions = data.suggestions || [];
                    }
                } else {
                    console.warn('AI analysis service unavailable');
                }
            }

            if (features.alternatives) {
                analysis.alternatives = await this.generateAlternativeSolutions(code);
            }

        } catch (error) {
            console.error('AI analysis error:', error);
            analysis.error = 'AI analysis unavailable';
        }

        return analysis;
    }

    async generateAlternativeSolutions(code) {
        // Placeholder for alternative solution generation
        return [
            {
                approach: 'Iterative Solution',
                description: 'Converting recursive solution to iterative using explicit stack/queue'
            },
            {
                approach: 'Space-Optimized',
                description: 'Reducing space complexity by reusing variables or in-place modifications'
            },
            {
                approach: 'Different Algorithm',
                description: 'Alternative algorithmic approach (e.g., BFS vs DFS, sliding window, etc.)'
            }
        ];
    }

    async ensureRepositoryExists(token, username, settings) {
        try {
            console.log(`Checking if repository ${username}/${settings.repoName} exists...`);
            
            const repoResponse = await fetch(`https://api.github.com/repos/${username}/${settings.repoName}`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                }
            });

            if (repoResponse.status === 404) {
                console.log('Repository does not exist, creating...');
                
                const createResponse = await fetch('https://api.github.com/user/repos', {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json',
                        'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                    },
                    body: JSON.stringify({
                        name: settings.repoName,
                        description: settings.repoDescription || 'My LeetCode solutions with AI analysis',
                        private: false,
                        auto_init: true,
                        gitignore_template: null,
                        license_template: 'mit'
                    })
                });

                if (!createResponse.ok) {
                    const error = await createResponse.json();
                    throw new Error(`Failed to create repository: ${error.message || error.error}`);
                }

                console.log('Repository created successfully');
                
                // Wait a bit for repository initialization
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Create initial README
                await this.createReadmeFile(token, username, settings.repoName);
            } else if (!repoResponse.ok) {
                const error = await repoResponse.json();
                throw new Error(`Failed to check repository: ${error.message || error.error}`);
            } else {
                console.log('Repository exists');
            }
        } catch (error) {
            console.error('Repository check/creation error:', error);
            if (!error.message.includes('Failed to create repository') && 
                !error.message.includes('Failed to check repository')) {
                // If it's just a network error, the repo might still exist
                console.warn('Continuing despite repository check error');
            } else {
                throw error;
            }
        }
    }

    async createReadmeFile(token, username, repoName) {
        try {
            const readmeContent = `# LeetCode Solutions 🚀

This repository contains my LeetCode solutions with AI-powered analysis and explanations.

## 📊 Statistics
- **Languages Used**: Multiple programming languages
- **Problems Solved**: Updated automatically
- **Last Updated**: ${new Date().toLocaleDateString()}

## 🤖 AI Features
- **Complexity Analysis**: Automated time and space complexity analysis
- **Code Optimization**: Suggestions for improving performance  
- **Alternative Solutions**: Different approaches to solve problems

## 📁 Structure
Solutions are organized by problem number and title:
\`\`\`
/solutions/
  ├── 0001-two-sum/
  │   ├── README.md
  │   └── solution.cpp
  ├── 0002-add-two-numbers/
  │   ├── README.md
  │   └── solution.py
  └── ...
\`\`\`

## 🔧 Generated by
[LeetCode GitHub Sync Extension](https://github.com/your-username/leetcode-github-sync)

---
*This README is auto-generated and updated by the LeetCode GitHub Sync extension.*`;

            const response = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/README.md`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                },
                body: JSON.stringify({
                    message: 'Initial README.md',
                    content: btoa(unescape(encodeURIComponent(readmeContent))),
                    committer: {
                        name: 'LeetCode Sync Bot',
                        email: 'noreply@leetcode-sync.com'
                    }
                })
            });

            if (response.ok) {
                console.log('README.md created successfully');
            } else {
                console.warn('Failed to create README.md, but continuing...');
            }
        } catch (error) {
            console.error('README creation error:', error);
            // Don't throw here, README creation is not critical
        }
    }

    generateFileName(data) {
        const paddedId = String(data.questionId).padStart(4, '0');
        const slug = data.titleSlug.toLowerCase();
        return `solutions/${paddedId}-${slug}/README.md`;
    }

    getFileExtension(langSlug) {
        const extensions = {
            'cpp': '.cpp',
            'java': '.java',
            'python': '.py',
            'python3': '.py',
            'javascript': '.js',
            'typescript': '.ts',
            'c': '.c',
            'csharp': '.cs',
            'go': '.go',
            'ruby': '.rb',
            'swift': '.swift',
            'kotlin': '.kt',
            'rust': '.rs',
            'php': '.php',
            'scala': '.scala'
        };
        return extensions[langSlug] || '.txt';
    }

    async generateSolutionFile(data, settings) {
        let content = `# ${data.questionId}. ${data.title}\n\n`;
        
        // Difficulty badge
        const difficultyEmojis = {
            'Easy': '🟢',
            'Medium': '🟡', 
            'Hard': '🔴'
        };
        content += `**Difficulty:** ${difficultyEmojis[data.difficulty] || '⚪'} ${data.difficulty}\n\n`;
        
        // Tags
        if (data.topicTags && data.topicTags.length > 0) {
            content += `**Topics:** ${data.topicTags.map(tag => `\`${tag}\``).join(', ')}\n\n`;
        }
        
        // Acceptance rate
        content += `**Acceptance Rate:** ${data.acceptanceRate}\n\n`;
        
        // Problem description
        content += `## Problem Description\n\n${data.description}\n\n`;
        
        // Examples
        if (data.examples && data.examples.length > 0) {
            content += `## Examples\n\n`;
            data.examples.forEach((example, index) => {
                content += `### Example ${index + 1}\n\`\`\`\n${example}\n\`\`\`\n\n`;
            });
        }
        
        // Constraints
        if (data.constraints && data.constraints.length > 0) {
            content += `## Constraints\n\n`;
            data.constraints.forEach(constraint => {
                content += `- ${constraint}\n`;
            });
            content += '\n';
        }
        
        // Solution
        content += `## Solution\n\n`;
        content += `**Language:** ${data.language}\n\n`;
        content += `\`\`\`${data.langSlug}\n${data.code}\n\`\`\`\n\n`;
        
        // Performance (only if we have submission data)
        if (data.runtime !== 'N/A' && data.memory !== 'N/A') {
            content += `## Performance\n\n`;
            content += `- **Runtime:** ${data.runtime}`;
            if (data.beats.runtime) {
                content += ` (beats ${data.beats.runtime}%)`;
            }
            content += '\n';
            content += `- **Memory:** ${data.memory}`;
            if (data.beats.memory) {
                content += ` (beats ${data.beats.memory}%)`;
            }
            content += '\n\n';
        }
        
        // AI Analysis
        if (data.aiAnalysis && Object.keys(data.aiAnalysis).length > 0) {
            content += `## AI Analysis\n\n`;
            
            if (data.aiAnalysis.complexity) {
                content += `### Complexity Analysis\n`;
                content += `- **Time Complexity:** ${data.aiAnalysis.complexity.time}\n`;
                content += `- **Space Complexity:** ${data.aiAnalysis.complexity.space}\n`;
                if (data.aiAnalysis.complexity.explanation) {
                    content += `\n${data.aiAnalysis.complexity.explanation}\n`;
                }
                content += '\n';
            }
            
            if (data.aiAnalysis.optimizations && data.aiAnalysis.optimizations.length > 0) {
                content += `### Optimization Suggestions\n`;
                data.aiAnalysis.optimizations.forEach(opt => {
                    content += `- ${opt}\n`;
                });
                content += '\n';
            }
            
            if (data.aiAnalysis.alternatives && data.aiAnalysis.alternatives.length > 0) {
                content += `### Alternative Approaches\n`;
                data.aiAnalysis.alternatives.forEach(alt => {
                    content += `#### ${alt.approach}\n${alt.description}\n\n`;
                });
            }
        }
        
        // Hints (if available)
        if (data.hints && data.hints.length > 0) {
            content += `## Hints\n\n`;
            data.hints.forEach((hint, index) => {
                content += `${index + 1}. ${hint}\n`;
            });
            content += '\n';
        }
        
        // Metadata
        content += `---\n\n`;
        content += `**Submitted:** ${new Date(data.timestamp).toLocaleString()}\n`;
        content += `**Generated by:** [LeetCode GitHub Sync Extension](https://github.com/your-username/leetcode-github-sync)\n`;
        
        return content;
    }

    async createOrUpdateFile(token, username, repoName, fileName, content, data) {
        try {
            // Check if file already exists
            let sha = null;
            try {
                const existingResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${fileName}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                    }
                });
                
                if (existingResponse.ok) {
                    const existingData = await existingResponse.json();
                    sha = existingData.sha;
                    console.log('File exists, will update');
                } else {
                    console.log('File does not exist, will create');
                }
            } catch (error) {
                console.log('File check failed, assuming new file');
            }

            // Create or update the markdown file
            const response = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${fileName}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                },
                body: JSON.stringify({
                    message: `${sha ? 'Update' : 'Add'} solution: ${data.questionId}. ${data.title}`,
                    content: btoa(unescape(encodeURIComponent(content))),
                    ...(sha && { sha }),
                    committer: {
                        name: 'LeetCode Sync Bot',
                        email: 'noreply@leetcode-sync.com'
                    }
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`GitHub API error: ${error.message || 'Unknown error'}`);
            }

            // Also create the separate code file if we have actual code
            if (data.code && data.code.trim() && data.langSlug !== 'unknown') {
                const codeFileName = fileName.replace('README.md', `solution${this.getFileExtension(data.langSlug)}`);
                await this.createCodeFile(token, username, repoName, codeFileName, data.code, data);
            }

            console.log('File created/updated successfully');
            return await response.json();
        } catch (error) {
            console.error('File creation/update error:', error);
            throw new Error(`Failed to create/update file: ${error.message}`);
        }
    }

    async createCodeFile(token, username, repoName, fileName, code, data) {
        try {
            // Check if code file already exists
            let sha = null;
            try {
                const existingResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${fileName}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                    }
                });
                
                if (existingResponse.ok) {
                    const existingData = await existingResponse.json();
                    sha = existingData.sha;
                }
            } catch (error) {
                // File doesn't exist, which is fine
            }

            const response = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${fileName}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'LeetCode-GitHub-Sync-Extension/1.0'
                },
                body: JSON.stringify({
                    message: `${sha ? 'Update' : 'Add'} ${data.language} solution for ${data.title}`,
                    content: btoa(unescape(encodeURIComponent(code))),
                    ...(sha && { sha }),
                    committer: {
                        name: 'LeetCode Sync Bot',
                        email: 'noreply@leetcode-sync.com'
                    }
                })
            });

            if (response.ok) {
                console.log('Code file created/updated successfully');
                return true;
            } else {
                console.warn('Failed to create/update code file, but continuing...');
                return false;
            }
        } catch (error) {
            console.error('Code file creation error:', error);
            return false;
        }
    }
}

// Initialize background service
new BackgroundService();