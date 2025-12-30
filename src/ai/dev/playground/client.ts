/**
 * AI Playground Client HTML/JS
 */

export const PLAYGROUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Veryfront AI Playground</title>
    <style>
        :root {
            --bg-color: #f8f9fa;
            --sidebar-bg: #ffffff;
            --border-color: #e9ecef;
            --primary: #3b82f6;
            --text-primary: #1f2937;
            --text-secondary: #6b7280;
        }

        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg-color);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
        }

        .sidebar {
            width: 280px;
            background: var(--sidebar-bg);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
        }

        .sidebar-header {
            padding: 1rem;
            border-bottom: 1px solid var(--border-color);
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .sidebar-content {
            flex: 1;
            overflow-y: auto;
            padding: 1rem;
        }

        .nav-section {
            margin-bottom: 1.5rem;
        }

        .nav-title {
            font-size: 0.75rem;
            text-transform: uppercase;
            color: var(--text-secondary);
            font-weight: 600;
            margin-bottom: 0.5rem;
            padding-left: 0.5rem;
        }

        .nav-item {
            display: block;
            padding: 0.5rem;
            border-radius: 0.375rem;
            cursor: pointer;
            color: var(--text-primary);
            text-decoration: none;
            margin-bottom: 0.25rem;
        }

        .nav-item:hover {
            background: var(--bg-color);
        }

        .nav-item.active {
            background: #eff6ff;
            color: var(--primary);
        }

        .main {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 2rem;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }

        .message {
            max-width: 80%;
            padding: 1rem;
            border-radius: 0.5rem;
            line-height: 1.5;
        }

        .message.user {
            align-self: flex-end;
            background: var(--primary);
            color: white;
        }

        .message.assistant {
            align-self: flex-start;
            background: white;
            border: 1px solid var(--border-color);
        }

        .message.tool {
            align-self: center;
            background: #f3f4f6;
            font-family: monospace;
            font-size: 0.875rem;
            width: 100%;
        }

        .input-area {
            padding: 1.5rem;
            background: white;
            border-top: 1px solid var(--border-color);
        }

        .input-form {
            display: flex;
            gap: 1rem;
            max-width: 800px;
            margin: 0 auto;
        }

        input[type="text"] {
            flex: 1;
            padding: 0.75rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: 0.5rem;
            font-size: 1rem;
        }

        input[type="text"]:focus {
            outline: none;
            border-color: var(--primary);
        }

        button {
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: 0.5rem;
            font-weight: 500;
            cursor: pointer;
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .tool-tester {
            padding: 2rem;
            max-width: 800px;
            margin: 0 auto;
        }

        .form-group {
            margin-bottom: 1rem;
        }

        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }

        textarea {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid var(--border-color);
            border-radius: 0.375rem;
            font-family: monospace;
            min-height: 100px;
        }

        .badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 500;
            background: #e5e7eb;
            margin-left: auto;
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="sidebar-header">
            ⚡ Veryfront Playground
        </div>
        <div class="sidebar-content">
            <div class="nav-section">
                <div class="nav-title">Agents</div>
                <div id="agent-list">
                    <!-- Agents will be listed here -->
                </div>
            </div>
            <div class="nav-section">
                <div class="nav-title">Tools</div>
                <div id="tool-list">
                    <!-- Tools will be listed here -->
                </div>
            </div>
        </div>
    </div>

    <div class="main">
        <div id="chat-view" class="chat-container">
            <div class="messages" id="messages">
                <div class="message assistant">
                    Hello! Select an agent from the sidebar to start testing.
                </div>
            </div>
            <div class="input-area">
                <form class="input-form" id="chat-form">
                    <input type="text" id="chat-input" placeholder="Type a message..." autocomplete="off">
                    <button type="submit">Send</button>
                </form>
            </div>
        </div>

        <div id="tool-view" class="tool-tester" style="display: none;">
            <h2 id="tool-name">Tool Name</h2>
            <p id="tool-description" style="color: var(--text-secondary); margin-bottom: 2rem;">Tool Description</p>
            
            <form id="tool-form">
                <div class="form-group">
                    <label>Arguments (JSON)</label>
                    <textarea id="tool-args">{}</textarea>
                </div>
                <button type="submit">Execute Tool</button>
            </form>

            <div style="margin-top: 2rem;">
                <label>Result</label>
                <pre id="tool-result" style="background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto;">No execution yet</pre>
            </div>
        </div>
    </div>

    <script>
        let currentView = 'chat';
        let activeAgent = null;
        let activeTool = null;

        // Fetch agents and tools
        async function fetchRegistry() {
            try {
                const response = await fetch('/_vf/playground/api/registry');
                const data = await response.json();
                renderRegistry(data);
            } catch (error) {
                console.error('Failed to fetch registry:', error);
            }
        }

        function renderRegistry(data) {
            const agentList = document.getElementById('agent-list');
            if (agentList) {
                agentList.innerHTML = data.agents.length ? '' : '<div class="nav-item">No agents found</div>';

                data.agents.forEach(agent => {
                    const el = document.createElement('div');
                    el.className = 'nav-item';
                    el.textContent = agent.id || 'Unnamed Agent';
                    el.onclick = () => selectAgent(agent.id);
                    agentList.appendChild(el);
                });
            }

            const toolList = document.getElementById('tool-list');
            if (toolList) {
                toolList.innerHTML = data.tools.length ? '' : '<div class="nav-item">No tools found</div>';

                data.tools.forEach(tool => {
                    const el = document.createElement('div');
                    el.className = 'nav-item';
                    el.textContent = tool.name;
                    el.onclick = () => selectTool(tool);
                    toolList.appendChild(el);
                });
            }
        }

        function selectAgent(id) {
            currentView = 'chat';
            activeAgent = id;
            const chatView = document.getElementById('chat-view');
            const toolView = document.getElementById('tool-view');
            const messages = document.getElementById('messages');
            if (chatView) chatView.style.display = 'flex';
            if (toolView) toolView.style.display = 'none';

            // Clear messages
            if (messages) {
                messages.innerHTML = \`
                    <div class="message assistant">
                        Chatting with agent: <strong>\${id}</strong>
                    </div>
                \`;
            }

            updateActiveNav();
        }

        function selectTool(tool) {
            currentView = 'tool';
            activeTool = tool;
            const chatView = document.getElementById('chat-view');
            const toolView = document.getElementById('tool-view');
            const toolName = document.getElementById('tool-name');
            const toolDesc = document.getElementById('tool-description');
            if (chatView) chatView.style.display = 'none';
            if (toolView) toolView.style.display = 'block';
            if (toolName) toolName.textContent = tool.name;
            if (toolDesc) toolDesc.textContent = tool.description;

            updateActiveNav();
        }

        function updateActiveNav() {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            // Highlight logic would go here based on text content matching
        }

        // Chat Form Handler
        document.getElementById('chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeAgent) return alert('Select an agent first');
            
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (!message) return;

            // Add user message
            addMessage(message, 'user');
            input.value = '';

            try {
                const response = await fetch('/_vf/playground/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        agentId: activeAgent,
                        message: message
                    })
                });

                const data = await response.json();
                addMessage(data.response, 'assistant');
            } catch (error) {
                addMessage('Error: ' + error.message, 'assistant');
            }
        });

        function addMessage(text, role) {
            const messages = document.getElementById('messages');
            const div = document.createElement('div');
            div.className = \`message \${role}\`;
            div.textContent = text;
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
        }

        // Tool Form Handler
        document.getElementById('tool-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeTool) return;

            const argsStr = document.getElementById('tool-args').value;
            let args;
            try {
                args = JSON.parse(argsStr);
            } catch (err) {
                return alert('Invalid JSON arguments');
            }

            try {
                const response = await fetch('/_vf/playground/api/tool', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        toolName: activeTool.name,
                        args: args
                    })
                });

                const result = await response.json();
                document.getElementById('tool-result').textContent = JSON.stringify(result, null, 2);
            } catch (error) {
                document.getElementById('tool-result').textContent = 'Error: ' + error.message;
            }
        });

        // Init
        fetchRegistry();
    </script>
</body>
</html>
`;
