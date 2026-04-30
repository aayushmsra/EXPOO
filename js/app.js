/**
 * EXPOO — Core Application Logic
 */
const App = (() => {

    // ─── Toast Notifications ───────────────────────────
    function toast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('removing');
            setTimeout(() => el.remove(), 300);
        }, 3500);
    }

    // ─── Modal System ──────────────────────────────────
    let modalBackdrop = null;

    function ensureModal() {
        if (modalBackdrop) return;
        modalBackdrop = document.createElement('div');
        modalBackdrop.className = 'modal-backdrop';
        modalBackdrop.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h2 class="modal-title"></h2>
                    <button class="modal-close" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body"></div>
            </div>`;
        document.body.appendChild(modalBackdrop);

        // Close on backdrop click
        modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) closeModal();
        });
        modalBackdrop.querySelector('.modal-close').addEventListener('click', closeModal);
    }

    function openModal(title, bodyHTML, options = {}) {
        ensureModal();
        modalBackdrop.querySelector('.modal-title').textContent = title;
        modalBackdrop.querySelector('.modal-body').innerHTML = bodyHTML;
        const modal = modalBackdrop.querySelector('.modal');
        const isMobile = window.innerWidth <= 480;
        if (isMobile) {
            // Full-screen on mobile
            modal.style.maxWidth = '100vw';
            modal.style.width = '100vw';
            modal.style.overflowY = 'hidden';
        } else if (options.wide) {
            modal.style.maxWidth = '90vw';
            modal.style.width = '90vw';
            modal.style.overflowY = 'hidden';
        } else {
            modal.style.maxWidth = '600px';
            modal.style.width = '90vw';
            modal.style.overflowY = 'auto';
        }
        modalBackdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        if (!modalBackdrop) return;
        modalBackdrop.classList.remove('open');
        document.body.style.overflow = '';
        // Stop any playing videos
        const vid = modalBackdrop.querySelector('video');
        if (vid) vid.pause();
    }

    // ─── Region Action Dispatcher ──────────────────────
    function executeAction(action) {
        if (!action) return;

        switch (action.type) {
            case 'popup':
                openModal(action.title || 'Info', action.body || '');
                break;

            case 'video':
                openZoomableVideo(action.title || 'Video', action.src);
                break;

            case 'link':
                if (action.url) {
                    window.open(action.url, action.target || '_blank');
                }
                break;

            case 'image':
                openZoomableImage(action.title || 'Image', action.src);
                break;

            default:
                toast('Unknown action type: ' + action.type, 'error');
        }
    }

    // ─── SVG Loader ────────────────────────────────────
    async function loadSVG(container, svgPath) {
        try {
            const resp = await fetch(svgPath);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');
            const svg = doc.querySelector('svg');
            if (!svg) throw new Error('Invalid SVG');

            const w = svg.getAttribute('width');
            const h = svg.getAttribute('height');
            if (!svg.getAttribute('viewBox') && w && h) {
                svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            }
            svg.removeAttribute('width');
            svg.removeAttribute('height');
            svg.style.width = '100%';
            svg.style.height = 'auto';

            // Index every path
            svg.querySelectorAll('path').forEach((p, i) => {
                if (!p.id) p.id = `svg-path-${i}`;
            });

            container.prepend(svg);
            return svg;
        } catch (err) {
            container.innerHTML = `<p style="padding:40px;color:var(--danger);">Failed to load SVG: ${err.message}</p>`;
            return null;
        }
    }

    // ─── Render Hotspots ───────────────────────────────
    function renderHotspots(container, regions) {
        container.querySelectorAll('.hotspot').forEach(el => el.remove());

        regions.forEach((r, i) => {
            const el = document.createElement('div');
            el.className = 'hotspot';
            el.dataset.regionId = r.id;
            el.dataset.index = i;
            el.setAttribute('data-label', r.label || '');
            el.style.left   = r.x + '%';
            el.style.top    = r.y + '%';
            el.style.width  = r.width + '%';
            el.style.height = r.height + '%';

            // Pulse dot
            const dot = document.createElement('span');
            dot.className = 'pulse-dot';
            el.appendChild(dot);

            // Click handler
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                executeAction(r.action);
            });

            container.appendChild(el);
        });
    }

    // ─── Zoomable Video Viewer ──────────────────────────
    function openZoomableVideo(title, src) {
        if (!src) {
            openModal(title, `
                <p style="color:var(--text-secondary)">No video source configured yet.</p>
                <p style="font-size:0.82rem;color:var(--text-muted);margin-top:8px;">
                    Set the <code>src</code> property in <code>content/regions.js</code> to a video URL.</p>
            `);
            return;
        }

        // On mobile: simple full-width video player (no zoom container)
        const isMobile = window.innerWidth <= 480;
        if (isMobile) {
            const html = `
                <video controls autoplay playsinline style="width:100%;max-height:70vh;border-radius:10px;background:#000;">
                    <source src="${src}">
                </video>
            `;
            openModal(title, html);
            return;
        }

        const html = `
            <div class="zoom-viewer">
                <div class="zoom-toolbar">
                    <button class="btn btn-sm" onclick="App.zoomMedia(-20)">➖</button>
                    <span class="zoom-level-label" id="zoom-img-label">100%</span>
                    <button class="btn btn-sm" onclick="App.zoomMedia(20)">➕</button>
                    <button class="btn btn-sm" onclick="App.zoomMedia(0)">Fit</button>
                    <button class="btn btn-sm" onclick="App.zoomMedia(999)">1:1</button>
                </div>
                <div class="zoom-container" id="zoom-container">
                    <video id="zoom-media" controls autoplay playsinline draggable="false"
                           style="transform-origin:0 0; cursor:grab;">
                        <source src="${src}">
                    </video>
                </div>
            </div>
        `;
        openModal(title, html, { wide: true });

        requestAnimationFrame(() => initZoomPanMedia('video'));
    }

    // ─── Zoomable Image Viewer ─────────────────────────
    function openZoomableImage(title, src) {
        if (!src) {
            openModal(title, `<p style="color:var(--text-secondary)">No image source configured.</p>`);
            return;
        }

        // On mobile: simple full-width, pinch-zoomable image
        const isMobile = window.innerWidth <= 480;
        if (isMobile) {
            const html = `
                <div style="flex:1;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;align-items:center;justify-content:center;">
                    <img src="${src}" alt="${title}" style="width:100%;height:auto;border-radius:10px;">
                </div>
            `;
            openModal(title, html);
            return;
        }

        const html = `
            <div class="zoom-viewer">
                <div class="zoom-toolbar">
                    <button class="btn btn-sm" onclick="App.zoomImage(-20)">➖</button>
                    <span class="zoom-level-label" id="zoom-img-label">100%</span>
                    <button class="btn btn-sm" onclick="App.zoomImage(20)">➕</button>
                    <button class="btn btn-sm" onclick="App.zoomImage(0)">Fit</button>
                    <button class="btn btn-sm" onclick="App.zoomImage(999)">1:1</button>
                </div>
                <div class="zoom-container" id="zoom-container">
                    <img src="${src}" alt="${title}" id="zoom-img" draggable="false"
                         style="transform-origin:0 0; cursor:grab;">
                </div>
            </div>
        `;
        openModal(title, html, { wide: true });

        requestAnimationFrame(() => initZoomPanMedia('image'));
    }

    // ─── Unified Zoom/Pan for Image & Video ────────────
    let zoomScale = 1;
    let panX = 0, panY = 0;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    function getMediaEl() {
        return document.getElementById('zoom-img') || document.getElementById('zoom-media');
    }

    function getMediaNaturalSize(el) {
        if (el.tagName === 'VIDEO') {
            return { w: el.videoWidth, h: el.videoHeight };
        }
        return { w: el.naturalWidth, h: el.naturalHeight };
    }

    function initZoomPanMedia(type) {
        const container = document.getElementById('zoom-container');
        const el = getMediaEl();
        if (!container || !el) return;

        zoomScale = 1;
        panX = 0;
        panY = 0;

        const doFit = () => {
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            const { w: nw, h: nh } = getMediaNaturalSize(el);
            if (nw && nh) {
                zoomScale = Math.min(cw / nw, ch / nh, 1);
                panX = (cw - nw * zoomScale) / 2;
                panY = (ch - nh * zoomScale) / 2;
                applyZoomTransform();
            }
        };

        if (type === 'video') {
            // Video needs loadedmetadata to know dimensions
            if (el.videoWidth) doFit();
            else el.addEventListener('loadedmetadata', doFit, { once: true });
        } else {
            if (el.complete && el.naturalWidth) doFit();
            else el.addEventListener('load', doFit, { once: true });
        }

        // Mouse wheel zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            const oldScale = zoomScale;
            const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            zoomScale = Math.max(0.1, Math.min(10, zoomScale * delta));

            panX = mx - (mx - panX) * (zoomScale / oldScale);
            panY = my - (my - panY) * (zoomScale / oldScale);
            applyZoomTransform();
        }, { passive: false });

        // Pan (only when not clicking video controls)
        container.addEventListener('mousedown', (e) => {
            // Don't intercept clicks on native video controls (bottom ~40px)
            if (type === 'video') {
                const rect = el.getBoundingClientRect();
                const relY = e.clientY - rect.top;
                const elH = rect.height;
                if (relY > elH - 44 * zoomScale) return; // skip controls area
            }
            isPanning = true;
            panStart = { x: e.clientX - panX, y: e.clientY - panY };
            el.style.cursor = 'grabbing';
        });
        container.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            panX = e.clientX - panStart.x;
            panY = e.clientY - panStart.y;
            applyZoomTransform();
        });
        const stopPan = () => {
            isPanning = false;
            if (el) el.style.cursor = 'grab';
        };
        container.addEventListener('mouseup', stopPan);
        container.addEventListener('mouseleave', stopPan);

        // ── Touch: pinch-to-zoom & pan ──
        let touchData = { dist: 0, startScale: 1, startPanX: 0, startPanY: 0, midX: 0, midY: 0, singleStart: null };

        function getTouchDist(t) {
            return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        }

        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                touchData.dist = getTouchDist(e.touches);
                touchData.startScale = zoomScale;
                touchData.startPanX = panX;
                touchData.startPanY = panY;
                const rect = container.getBoundingClientRect();
                touchData.midX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
                touchData.midY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
            } else if (e.touches.length === 1) {
                touchData.singleStart = { x: e.touches[0].clientX - panX, y: e.touches[0].clientY - panY };
            }
        }, { passive: false });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const newDist = getTouchDist(e.touches);
                const scale = newDist / touchData.dist;
                const newScale = Math.max(0.1, Math.min(10, touchData.startScale * scale));
                const ratio = newScale / touchData.startScale;
                panX = touchData.midX - (touchData.midX - touchData.startPanX) * ratio;
                panY = touchData.midY - (touchData.midY - touchData.startPanY) * ratio;
                zoomScale = newScale;
                applyZoomTransform();
            } else if (e.touches.length === 1 && touchData.singleStart) {
                e.preventDefault();
                panX = e.touches[0].clientX - touchData.singleStart.x;
                panY = e.touches[0].clientY - touchData.singleStart.y;
                applyZoomTransform();
            }
        }, { passive: false });

        container.addEventListener('touchend', () => {
            touchData.singleStart = null;
        });
    }

    function applyZoomTransform() {
        const el = getMediaEl();
        const label = document.getElementById('zoom-img-label');
        if (el) {
            el.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
        }
        if (label) {
            label.textContent = Math.round(zoomScale * 100) + '%';
        }
    }

    function zoomMedia(delta) {
        const container = document.getElementById('zoom-container');
        const el = getMediaEl();
        if (!container || !el) return;

        const { w: nw, h: nh } = getMediaNaturalSize(el);

        if (delta === 0) {
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            zoomScale = Math.min(cw / nw, ch / nh, 1);
            panX = (cw - nw * zoomScale) / 2;
            panY = (ch - nh * zoomScale) / 2;
        } else if (delta === 999) {
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            zoomScale = 1;
            panX = (cw - nw) / 2;
            panY = (ch - nh) / 2;
        } else {
            const cx = container.clientWidth / 2;
            const cy = container.clientHeight / 2;
            const oldScale = zoomScale;
            zoomScale = Math.max(0.1, Math.min(10, zoomScale + delta / 100));
            panX = cx - (cx - panX) * (zoomScale / oldScale);
            panY = cy - (cy - panY) * (zoomScale / oldScale);
        }
        applyZoomTransform();
    }

    // ─── Keyboard shortcut (Escape to close modal) ────
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // ─── Public API ────────────────────────────────────
    return {
        toast,
        openModal,
        closeModal,
        executeAction,
        loadSVG,
        renderHotspots,
        zoomImage: zoomMedia,
        zoomMedia
    };

})();
