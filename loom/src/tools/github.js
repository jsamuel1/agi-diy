// ═══════════════════════════════════════════════════════════════════════════
// GITHUB — auth, search, read, create PR, issues
// ═══════════════════════════════════════════════════════════════════════════

import { tool, z } from '../vendor/strands.js';
import { state } from '../state/store.js';
import { showToast } from '../ui/toast.js';
import { addMessageToUI } from '../ui/messages.js';
import { getPipelines, getActivePipeline, savePipelines, renderCompletionCards } from '../ui/pipeline.js';

function ghToken() { return state.credentials.github?.token || ''; }

async function ghApi(path, opts = {}) {
    const token = ghToken();
    if (!token) throw new Error('GitHub not authenticated. Add a token in Settings.');
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const res = await fetch(url, { ...opts, headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json', ...opts.headers } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    return res.status === 204 ? {} : res.json();
}

export function initGitHubDeviceFlow() {
    window.githubDeviceFlow = async function() {
        const clientId = prompt('Enter your GitHub OAuth App Client ID:');
        if (!clientId) return;
        try {
            const codeRes = await fetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, scope: 'repo' }) }).then(r => r.json());
            showToast(`Go to ${codeRes.verification_uri} and enter: ${codeRes.user_code}`);
            addMessageToUI('system', `🔑 GitHub Device Flow: Go to **${codeRes.verification_uri}** and enter code: **${codeRes.user_code}**`);
            const interval = (codeRes.interval || 5) * 1000;
            const poll = setInterval(async () => {
                try {
                    const tokenRes = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, device_code: codeRes.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) }).then(r => r.json());
                    if (tokenRes.access_token) {
                        clearInterval(poll);
                        state.credentials.github = { token: tokenRes.access_token };
                        document.getElementById('githubToken').value = tokenRes.access_token;
                        showToast('GitHub authenticated!');
                        addMessageToUI('system', '✅ GitHub authenticated successfully');
                    }
                } catch {}
            }, interval);
            setTimeout(() => clearInterval(poll), (codeRes.expires_in || 900) * 1000);
        } catch (e) { showToast('Device flow failed: ' + e.message); }
    };
}

export const githubSearchTool = tool({ name: 'github_search', description: 'Search GitHub.', inputSchema: z.object({ query: z.string(), type: z.enum(['code','repositories','issues']).optional() }), callback: async (input) => { const type = input.type || 'repositories'; const data = await ghApi(`/search/${type}?q=${encodeURIComponent(input.query)}&per_page=10`); return { total: data.total_count, items: data.items?.map(i => ({ name: i.full_name || i.name, url: i.html_url, description: i.description })) }; } });
export const githubReadFileTool = tool({ name: 'github_read_file', description: 'Read a file from a GitHub repo.', inputSchema: z.object({ owner: z.string(), repo: z.string(), path: z.string(), ref: z.string().optional() }), callback: async (input) => { const ref = input.ref ? `?ref=${input.ref}` : ''; const data = await ghApi(`/repos/${input.owner}/${input.repo}/contents/${input.path}${ref}`); return { path: data.path, content: atob(data.content), size: data.size }; } });
export const githubListReposTool = tool({ name: 'github_list_repos', description: 'List repos.', inputSchema: z.object({ owner: z.string().optional(), type: z.enum(['all','owner','member']).optional() }), callback: async (input) => { const path = input.owner ? `/users/${input.owner}/repos` : '/user/repos'; return (await ghApi(`${path}?per_page=30&sort=updated&type=${input.type || 'all'}`)).map(r => ({ name: r.full_name, description: r.description, url: r.html_url, stars: r.stargazers_count })); } });
export const githubCreateIssueTool = tool({ name: 'github_create_issue', description: 'Create a GitHub issue.', inputSchema: z.object({ owner: z.string(), repo: z.string(), title: z.string(), body: z.string().optional(), labels: z.array(z.string()).optional() }), callback: async (input) => { const data = await ghApi(`/repos/${input.owner}/${input.repo}/issues`, { method: 'POST', body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels }) }); return { number: data.number, url: data.html_url }; } });
export const githubListIssuesTool = tool({ name: 'github_list_issues', description: 'List issues.', inputSchema: z.object({ owner: z.string(), repo: z.string(), state: z.enum(['open','closed','all']).optional() }), callback: async (input) => (await ghApi(`/repos/${input.owner}/${input.repo}/issues?state=${input.state || 'open'}&per_page=20`)).map(i => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, labels: i.labels?.map(l => l.name) })) });
export const githubCreatePrTool = tool({ name: 'github_create_pr', description: 'Create a pull request.', inputSchema: z.object({ owner: z.string(), repo: z.string(), title: z.string(), body: z.string().optional(), head: z.string(), base: z.string().optional() }), callback: async (input) => { const data = await ghApi(`/repos/${input.owner}/${input.repo}/pulls`, { method: 'POST', body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base || 'main' }) }); const pipelines = getPipelines(); const active = getActivePipeline(pipelines); if (active) { if (!active.completionActions) active.completionActions = []; active.completionActions.push({ label: `PR #${data.number}`, description: input.title, url: data.html_url }); savePipelines(pipelines); renderCompletionCards(active); } return { number: data.number, url: data.html_url }; } });
export const githubReadPrTool = tool({ name: 'github_read_pr', description: 'Read PR details.', inputSchema: z.object({ owner: z.string(), repo: z.string(), number: z.number() }), callback: async (input) => { const [pr, reviews] = await Promise.all([ghApi(`/repos/${input.owner}/${input.repo}/pulls/${input.number}`), ghApi(`/repos/${input.owner}/${input.repo}/pulls/${input.number}/reviews`)]); return { title: pr.title, state: pr.state, mergeable: pr.mergeable, additions: pr.additions, deletions: pr.deletions, url: pr.html_url, reviews: reviews.map(r => ({ user: r.user?.login, state: r.state })) }; } });
