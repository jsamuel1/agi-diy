import { Widget } from './widget-interface.js';

const STATUS_ICON = {
  'success': '✅',
  'error': '❌',
  'blocked': '🚫',
  'no-gateway': '⚠️',
  'no-uri': '⚠️',
  'unsupported': '⚠️',
  'pending': '⏳'
};

export default new Widget({
  id: 'erc8004',
  meta: { icon: '⛓️', title: 'ERC8004 Discovery' },
  
  render(container) {
    const agents = window.AgentMesh?.erc8004?.discoveredAgents || [];
    
    if (!agents.length) {
      container.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No on-chain agents discovered</div>';
      return;
    }
    
    container.innerHTML = '<div style="padding:12px;font-size:12px">' + agents.map(a => {
      const statusIcon = STATUS_ICON[a.fetchStatus] || '❓';
      const statusText = a.fetchStatus === 'success' ? 'Fetched' : 
                        a.fetchStatus === 'blocked' ? 'Blocked' :
                        a.fetchStatus === 'error' ? 'CORS/Error' :
                        a.fetchStatus === 'no-uri' ? 'No URI' :
                        a.fetchStatus === 'no-gateway' ? 'No IPFS Gateway' :
                        a.fetchStatus === 'unsupported' ? 'Unsupported URI' : 'Pending';
      
      const agentId = a.registration?.agentId || `Agent #${a.agentId}`;
      const chainBadge = `<span style="background:var(--border);padding:2px 6px;border-radius:3px;font-size:10px">${a.chain}</span>`;
      
      return `
        <div style="border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:16px">${statusIcon}</span>
            <strong style="flex:1">${agentId}</strong>
            ${chainBadge}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">
            Owner: ${a.owner.slice(0,6)}...${a.owner.slice(-4)}
          </div>
          ${a.uri ? `<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;word-break:break-all">URI: ${a.uri.slice(0,60)}${a.uri.length > 60 ? '...' : ''}</div>` : ''}
          <div style="font-size:10px;color:${a.fetchStatus === 'success' ? 'var(--green)' : 'var(--orange)'}">
            ${statusText}${a.fetchError ? `: ${a.fetchError}` : ''}
          </div>
          ${a.registration ? `
            <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Linked Agents:</div>
              ${(a.registration.agents || []).map(aid => 
                `<div class="erc8004-agent-link" data-agent="${aid}" style="cursor:pointer;padding:4px;border-radius:3px;font-size:11px;color:var(--accent);margin-bottom:2px">
                  📎 ${aid}
                </div>`
              ).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('') + '</div>';
    
    // Add click handlers for linked agents
    container.querySelectorAll('.erc8004-agent-link').forEach(el => {
      el.addEventListener('dblclick', () => {
        const agentId = el.dataset.agent;
        if (window.openAgentDetail) window.openAgentDetail(agentId);
      });
    });
  }
});
