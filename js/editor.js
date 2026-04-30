/**
 * EXPOO — Editor Module
 * Handles drawing, editing, exporting, file browsing, and server-saving of clickable regions.
 * Supports both local server (python server.py) and GitHub Pages (via GitHub API).
 */
const Editor = (() => {

    let mode = 'select';   // 'select' | 'draw'
    let isDrawing = false;
    let drawStart = { x: 0, y: 0 };
    let drawEl = null;
    let editingIndex = -1;
    let regions = [];       // local mutable copy
    let cachedFiles = null; // cached file listing
    let activeFileTab = 'images';
    let hasUnsavedChanges = false;

    // ─── GitHub Config ─────────────────────────────────
    const GITHUB_OWNER = 'aayushmsra';
    const GITHUB_REPO  = 'EXPOO';
    const GITHUB_BRANCH = 'main';
    const REGIONS_PATH  = 'content/regions.js';

    function getGitHubToken() {
        return localStorage.getItem('expoo_github_token') || '';
    }
    function setGitHubToken(token) {
        localStorage.setItem('expoo_github_token', token);
    }
    function isLocalServer() {
        return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    }

    // ─── Init ──────────────────────────────────────────
    async function init() {
        const viewport = document.getElementById('editor-viewport');
        const wrapper  = document.getElementById('editor-wrapper');
        const img      = document.getElementById('editor-img');
        if (!viewport || !wrapper || !img) return;

        // Wait for image to load so dimensions are known
        if (!img.complete) {
            await new Promise((resolve, reject) => {
                img.addEventListener('load', resolve, { once: true });
                img.addEventListener('error', reject, { once: true });
            });
        }

        // Copy global regions
        regions = JSON.parse(JSON.stringify(window.REGIONS || []));

        render();
        attachListeners();

        // Pre-fetch file listing
        fetchFileList();

        updateStatus(`Ready — ${regions.length} regions loaded. Select a mode from the toolbar.`);
    }

    // ─── Mode ──────────────────────────────────────────
    function setMode(m) {
        mode = m;
        const viewport = document.getElementById('editor-viewport');
        viewport.classList.toggle('drawing-mode', m === 'draw');
        viewport.style.cursor = m === 'draw' ? 'crosshair' : 'default';

        document.querySelectorAll('.editor-toolbar .btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.editor-toolbar .btn[data-mode="${m}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        if (m === 'draw') updateStatus('Click and drag on the poster to create a new region');
        else updateStatus('Click on a region to edit it');

        closeSidebarForm();
    }

    // ─── Render Regions ────────────────────────────────
    function render() {
        const wrapper = document.getElementById('editor-wrapper');
        wrapper.querySelectorAll('.hotspot').forEach(el => el.remove());

        regions.forEach((r, i) => {
            const el = document.createElement('div');
            el.className = 'hotspot';
            el.dataset.index = i;
            el.setAttribute('data-label', r.label || `Region ${i + 1}`);
            el.style.left   = r.x + '%';
            el.style.top    = r.y + '%';
            el.style.width  = r.width + '%';
            el.style.height = r.height + '%';
            el.style.borderColor = 'rgba(88,166,255,0.5)';
            el.style.background = 'rgba(88,166,255,0.08)';

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (mode === 'select') openEditForm(i);
            });

            wrapper.appendChild(el);
        });

        renderSidebarList();
    }

    function renderSidebarList() {
        const list = document.getElementById('region-list');
        if (!list) return;

        // Update count
        const countEl = document.getElementById('region-count');
        if (countEl) countEl.textContent = `(${regions.length})`;

        if (regions.length === 0) {
            list.innerHTML = `<p style="font-size:0.82rem;color:var(--text-muted)">No regions yet. Switch to Draw mode and create one!</p>`;
            return;
        }

        list.innerHTML = regions.map((r, i) => `
            <div class="region-list-item" data-index="${i}">
                <span class="rl-label">${r.label || 'Untitled'}</span>
                <span class="rl-type">${r.action?.type || 'none'}</span>
            </div>
        `).join('');

        list.querySelectorAll('.region-list-item').forEach(el => {
            el.addEventListener('click', () => openEditForm(+el.dataset.index));
        });
    }

    // ─── Drawing ───────────────────────────────────────
    function attachListeners() {
        const viewport = document.getElementById('editor-viewport');
        const wrapper  = document.getElementById('editor-wrapper');

        viewport.addEventListener('mousedown', (e) => {
            if (mode !== 'draw') return;
            if (e.target.closest('.hotspot')) return;
            isDrawing = true;
            const rect = wrapper.getBoundingClientRect();
            drawStart.x = e.clientX - rect.left;
            drawStart.y = e.clientY - rect.top;

            drawEl = document.createElement('div');
            drawEl.className = 'draw-rect';
            drawEl.style.left = drawStart.x + 'px';
            drawEl.style.top  = drawStart.y + 'px';
            wrapper.appendChild(drawEl);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDrawing || !drawEl) return;
            const rect = document.getElementById('editor-wrapper').getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            drawEl.style.left   = Math.min(drawStart.x, cx) + 'px';
            drawEl.style.top    = Math.min(drawStart.y, cy) + 'px';
            drawEl.style.width  = Math.abs(cx - drawStart.x) + 'px';
            drawEl.style.height = Math.abs(cy - drawStart.y) + 'px';
        });

        document.addEventListener('mouseup', (e) => {
            if (!isDrawing || !drawEl) return;
            isDrawing = false;
            const rect = wrapper.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            const x = Math.min(drawStart.x, cx);
            const y = Math.min(drawStart.y, cy);
            const w = Math.abs(cx - drawStart.x);
            const h = Math.abs(cy - drawStart.y);

            drawEl.remove();
            drawEl = null;

            if (w > 10 && h > 10) {
                const sw = wrapper.offsetWidth;
                const sh = wrapper.offsetHeight;

                const newRegion = {
                    id: 'region-' + Date.now(),
                    x: +(x / sw * 100).toFixed(2),
                    y: +(y / sh * 100).toFixed(2),
                    width:  +(w / sw * 100).toFixed(2),
                    height: +(h / sh * 100).toFixed(2),
                    label: '',
                    action: { type: 'popup', title: '', body: '' }
                };
                regions.push(newRegion);
                hasUnsavedChanges = true;
                render();
                openEditForm(regions.length - 1);
                App.toast('New region created — configure it in the sidebar', 'success');
            }
        });

        // Ctrl+Scroll to zoom
        viewport.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const img = document.getElementById('editor-img');
            const currentW = wrapper.offsetWidth;
            const naturalW = img.naturalWidth;
            const currentPct = Math.round(currentW / naturalW * 100);
            const delta = e.deltaY < 0 ? 10 : -10;
            const newPct = Math.max(20, Math.min(300, currentPct + delta));
            wrapper.style.minWidth = '0';
            wrapper.style.width = (naturalW * newPct / 100) + 'px';
        }, { passive: false });

        // Warn on unsaved changes
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    // ─── Edit Form ─────────────────────────────────────
    function openEditForm(index) {
        editingIndex = index;
        const r = regions[index];
        if (!r) return;

        const sidebar = document.getElementById('editor-sidebar');
        sidebar.classList.add('open');

        document.getElementById('ef-label').value    = r.label || '';
        document.getElementById('ef-type').value     = r.action?.type || 'popup';
        document.getElementById('ef-title').value    = r.action?.title || '';
        document.getElementById('ef-body').value     = r.action?.body || '';
        document.getElementById('ef-url').value      = r.action?.url || r.action?.src || '';
        document.getElementById('ef-target').value   = r.action?.target || '_blank';

        toggleFieldsByType(r.action?.type || 'popup');

        // Close file browser when switching regions
        closeFileBrowser();

        // Highlight the active region
        document.querySelectorAll('.hotspot').forEach(el => {
            el.style.borderColor = (+el.dataset.index === index) ? 'var(--accent)' : 'rgba(88,166,255,0.5)';
        });

        updateStatus(`Editing: ${r.label || 'Region ' + (index + 1)}`);
    }

    function closeSidebarForm() {
        editingIndex = -1;
        const sidebar = document.getElementById('editor-sidebar');
        if (sidebar) sidebar.classList.remove('open');
        closeFileBrowser();
        document.querySelectorAll('.hotspot').forEach(el => {
            el.style.borderColor = 'rgba(88,166,255,0.5)';
        });
    }

    function toggleFieldsByType(type) {
        document.getElementById('ef-group-body').style.display = (type === 'popup') ? '' : 'none';
        document.getElementById('ef-group-url').style.display  = ['link', 'video', 'image'].includes(type) ? '' : 'none';
        document.getElementById('ef-group-target').style.display = (type === 'link') ? '' : 'none';
        document.getElementById('ef-group-title').style.display = (type !== 'link') ? '' : 'none';

        // Auto-switch file browser tab based on type
        if (type === 'video') activeFileTab = 'videos';
        else if (type === 'image') activeFileTab = 'images';
    }

    function saveForm() {
        if (editingIndex < 0) return;
        const r = regions[editingIndex];
        const type = document.getElementById('ef-type').value;

        r.label = document.getElementById('ef-label').value;
        r.action = { type };

        if (type === 'popup') {
            r.action.title = document.getElementById('ef-title').value;
            r.action.body  = document.getElementById('ef-body').value;
        } else if (type === 'video') {
            r.action.title = document.getElementById('ef-title').value;
            r.action.src   = document.getElementById('ef-url').value;
        } else if (type === 'image') {
            r.action.title = document.getElementById('ef-title').value;
            r.action.src   = document.getElementById('ef-url').value;
        } else if (type === 'link') {
            r.action.url    = document.getElementById('ef-url').value;
            r.action.target = document.getElementById('ef-target').value;
        }

        hasUnsavedChanges = true;
        render();
        closeFileBrowser();
        closeSidebarForm();
        App.toast('Region saved!', 'success');
    }

    function deleteRegion() {
        if (editingIndex < 0) return;
        regions.splice(editingIndex, 1);
        hasUnsavedChanges = true;
        closeSidebarForm();
        render();
        App.toast('Region deleted', 'info');
    }

    // ─── File Browser ──────────────────────────────────
    async function fetchFileList() {
        // Try local server first
        if (isLocalServer()) {
            try {
                const resp = await fetch('/api/files');
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                cachedFiles = await resp.json();
                return;
            } catch (err) {
                console.warn('Local API not available, trying GitHub:', err);
            }
        }

        // Fall back to GitHub API
        try {
            const headers = {};
            const token = getGitHubToken();
            if (token) headers['Authorization'] = `token ${token}`;

            const [imgResp, vidResp] = await Promise.all([
                fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/images?ref=${GITHUB_BRANCH}`, { headers }),
                fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/videos?ref=${GITHUB_BRANCH}`, { headers }),
            ]);

            const imgFiles = imgResp.ok ? await imgResp.json() : [];
            const vidFiles = vidResp.ok ? await vidResp.json() : [];

            const mapFiles = (arr, folder) => arr
                .filter(f => f.type === 'file' && !f.name.startsWith('.'))
                .map(f => ({
                    name: f.name,
                    path: `${folder}/${f.name}`,
                    ext: '.' + f.name.split('.').pop().toLowerCase(),
                    size: f.size
                }));

            cachedFiles = {
                images: { folder: 'assets/images', files: mapFiles(imgFiles, 'assets/images') },
                videos: { folder: 'assets/videos', files: mapFiles(vidFiles, 'assets/videos') },
            };
        } catch (err) {
            console.warn('Could not fetch file list from GitHub:', err);
            cachedFiles = null;
        }
    }

    function openFileBrowser() {
        const fb = document.getElementById('file-browser');
        if (!fb) return;
        fb.style.display = '';

        // Auto switch tab based on action type
        const type = document.getElementById('ef-type')?.value;
        if (type === 'video') activeFileTab = 'videos';
        else activeFileTab = 'images';

        // Update active tab UI
        document.querySelectorAll('.fb-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.folder === activeFileTab);
        });

        renderFileBrowser();
    }

    function closeFileBrowser() {
        const fb = document.getElementById('file-browser');
        if (fb) fb.style.display = 'none';
    }

    function switchFileTab(tab) {
        activeFileTab = tab;
        document.querySelectorAll('.fb-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.folder === tab);
        });
        renderFileBrowser();
    }

    async function renderFileBrowser() {
        const list = document.getElementById('fb-file-list');
        if (!list) return;

        // Refresh file listing if not cached
        if (!cachedFiles) {
            list.innerHTML = '<p class="fb-hint">Loading files…</p>';
            await fetchFileList();
        }

        if (!cachedFiles || !cachedFiles[activeFileTab]) {
            list.innerHTML = '<p class="fb-hint">Could not load files.<br>Make sure you run <strong>python server.py</strong> instead of a basic HTTP server.</p>';
            return;
        }

        const files = cachedFiles[activeFileTab].files;
        const folderPath = cachedFiles[activeFileTab].folder;

        if (files.length === 0) {
            list.innerHTML = `
                <div class="fb-empty-hint">
                    No files found.<br>
                    <strong>Drop files into:</strong><br>
                    <code style="font-size:0.78rem;background:var(--bg-alt);padding:2px 6px;border-radius:4px">
                        ${folderPath}/
                    </code><br>
                    then click <em>Refresh</em> below.
                    <br><br>
                    <button class="btn btn-sm" onclick="Editor.refreshFiles()">🔄 Refresh</button>
                </div>
            `;
            return;
        }

        list.innerHTML = files.map(f => `
            <div class="fb-file-item" onclick="Editor.selectFile('${f.path}')" title="${f.path}">
                <span class="fb-name">${getFileIcon(f.ext)} ${f.name}</span>
                <span class="fb-size">${formatSize(f.size)}</span>
            </div>
        `).join('') + `
            <div style="text-align:center;padding:8px;">
                <button class="btn btn-sm" onclick="Editor.refreshFiles()" style="font-size:0.75rem;">🔄 Refresh</button>
            </div>
        `;
    }

    function selectFile(path) {
        document.getElementById('ef-url').value = path;
        closeFileBrowser();
        App.toast(`Selected: ${path}`, 'success');
    }

    async function refreshFiles() {
        cachedFiles = null;
        await fetchFileList();
        renderFileBrowser();
        App.toast('File list refreshed', 'info');
    }

    function getFileIcon(ext) {
        const icons = {
            '.png': '🖼', '.jpg': '🖼', '.jpeg': '🖼', '.gif': '🖼',
            '.webp': '🖼', '.svg': '🖼', '.bmp': '🖼',
            '.mp4': '🎬', '.webm': '🎬', '.mov': '🎬',
            '.avi': '🎬', '.mkv': '🎬', '.ogg': '🎬',
        };
        return icons[ext] || '📄';
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // ─── Save to Server / GitHub ────────────────────────
    async function saveToServer() {
        if (isLocalServer()) {
            await saveToLocalServer();
        } else {
            await saveToGitHub();
        }
    }

    async function saveToLocalServer() {
        updateStatus('Saving to server…');
        try {
            const resp = await fetch('/api/regions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regions),
            });

            const data = await resp.json();
            if (data.ok) {
                hasUnsavedChanges = false;
                App.toast(`Saved ${data.count} regions to server! Poster will auto-update on refresh.`, 'success');
                updateStatus(`Saved ${data.count} regions. All changes live!`);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (err) {
            App.toast('Save failed: ' + err.message, 'error');
            updateStatus('Save failed — check console');
            console.error('Save error:', err);
        }
    }

    async function saveToGitHub() {
        let token = getGitHubToken();
        if (!token) {
            token = prompt('Enter your GitHub Personal Access Token (with repo scope) to save:');
            if (!token) { App.toast('Save cancelled — no token provided', 'error'); return; }
            setGitHubToken(token);
        }

        updateStatus('Saving to GitHub…');
        try {
            // Get current file SHA (required for updates)
            const getResp = await fetch(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${REGIONS_PATH}?ref=${GITHUB_BRANCH}`,
                { headers: { 'Authorization': `token ${token}` } }
            );
            let sha = '';
            if (getResp.ok) {
                const existing = await getResp.json();
                sha = existing.sha;
            }

            // Build file content
            const fileContent = `/**\n * EXPOO — Regions Configuration (auto-saved by editor)\n * Last saved: ${new Date().toISOString()}\n */\n\nconst REGIONS = ${JSON.stringify(regions, null, 4)};\n\nwindow.REGIONS = REGIONS;\n`;

            // Commit via GitHub API
            const putResp = await fetch(
                `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${REGIONS_PATH}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: `Update regions (${regions.length} regions) via EXPOO editor`,
                        content: btoa(unescape(encodeURIComponent(fileContent))),
                        sha: sha || undefined,
                        branch: GITHUB_BRANCH,
                    }),
                }
            );

            if (!putResp.ok) {
                const errData = await putResp.json();
                if (putResp.status === 401) {
                    localStorage.removeItem('expoo_github_token');
                    throw new Error('Invalid token — cleared. Try saving again.');
                }
                throw new Error(errData.message || `HTTP ${putResp.status}`);
            }

            hasUnsavedChanges = false;
            App.toast(`Saved ${regions.length} regions to GitHub! Site will update in ~1 min.`, 'success');
            updateStatus(`Saved ${regions.length} regions to GitHub. Live soon!`);
        } catch (err) {
            App.toast('GitHub save failed: ' + err.message, 'error');
            updateStatus('Save failed — ' + err.message);
            console.error('GitHub save error:', err);
        }
    }

    function clearToken() {
        localStorage.removeItem('expoo_github_token');
        App.toast('GitHub token cleared', 'info');
    }

    // ─── Export / Import ───────────────────────────────
    function exportJSON() {
        const json = JSON.stringify(regions, null, 4);
        navigator.clipboard.writeText(json).then(() => {
            App.toast('JSON copied to clipboard!', 'success');
        }).catch(() => {
            const ta = document.createElement('textarea'); ta.value = json;
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); document.body.removeChild(ta);
            App.toast('JSON copied to clipboard!', 'success');
        });
        console.log('REGIONS =', json);
    }

    function importJSON() {
        const input = prompt('Paste your regions JSON here:');
        if (!input) return;
        try {
            const parsed = JSON.parse(input);
            if (!Array.isArray(parsed)) throw new Error('Expected an array');
            regions = parsed;
            hasUnsavedChanges = true;
            render();
            App.toast(`Imported ${regions.length} regions`, 'success');
        } catch (err) {
            App.toast('Invalid JSON: ' + err.message, 'error');
        }
    }

    // ─── Status ────────────────────────────────────────
    function updateStatus(text) {
        const el = document.getElementById('editor-status');
        if (el) el.textContent = text;
    }

    // ─── Public ────────────────────────────────────────
    return {
        init,
        setMode,
        saveForm,
        deleteRegion,
        exportJSON,
        importJSON,
        toggleFieldsByType,
        // File browser
        openFileBrowser,
        closeFileBrowser,
        switchFileTab,
        selectFile,
        refreshFiles,
        // Server / GitHub save
        saveToServer,
        clearToken,
    };

})();
