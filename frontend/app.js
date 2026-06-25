document.addEventListener('alpine:init', () => {
    const AC_FIELDS = ['orientation', 'resolution', 'frame_rate', 'is_kept', 'is_rejected',
                       'tags', 'recorded_at', 'latitude', 'longitude', 'file_name', 'short_name'];
    const AC_OPERATORS = {
        orientation:  ['=', '!='],
        resolution:   ['=', '!='],
        frame_rate:   ['=', '!=', '>', '<', '>=', '<='],
        is_kept:      ['='],
        is_rejected:  ['='],
        tags:         ['IN', 'NOT IN'],
        recorded_at:  ['=', '!=', '>', '<', '>=', '<='],
        latitude:     ['=', '!=', '>', '<', '>=', '<='],
        longitude:    ['=', '!=', '>', '<', '>=', '<='],
        file_name:    ['=', '!='],
        short_name:   ['=', '!='],
    };
    const AC_VALUES = {
        orientation:  ['"landscape"', '"portrait"'],
        is_kept:      ['true', 'false'],
        is_rejected:  ['true', 'false'],
    };

    Alpine.data('app', () => ({
        status: 'Ready',
        statusType: 'info',
        scanPath: '/Users/crs/Desktop/test1/',
        scanning: false,
        scanProgress: 0,
        scanStatusText: '',

        clips: [],
        selectedClip: null,
        markers: [],
        pendingMarkerStart: null,

        proxyStatuses: {},
        proxyQueueActive: false,
        proxyQueueTotal: 0,
        proxyQueueProcessed: 0,
        proxyQueueFailed: 0,
        showTagInput: null,
        newTagName: '',

        sequences: [],
        activeSequenceId: '',
        activeSequenceItems: [],

        queryFilter: '',
        queryHelpOpen: false,
        queryHelpContent: '',
        tagPalette: ['Wide', 'Slow-Mo', 'Close-Up', 'Cutaway', 'Drone', 'Establishing', 'Motion', 'Static'],

        librarySort: 'date',
        librarySortDir: 'asc',

        focusMode: false,
        shortcutHelpOpen: false,

        markerNoteModalOpen: false,
        markerNoteModalTitle: 'Marker Note',
        markerNoteDraft: '',
        markerNoteResolve: null,

        sequenceNameModalOpen: false,
        sequenceNameDraft: '',
        sequenceNameResolve: null,

        markdownPreviewOpen: false,
        markdownPreviewContent: '',

        toasts: [],
        toastId: 0,

        acOpen: false,
        acItems: [],
        acIndex: -1,
        acReplaceStart: 0,

        // Shuttle state
        shuttleSpeed: 0,
        shuttleTimeout: null,

        async init() {
            console.log('SceneFlow App Initialized');
            this.status = 'Connecting…';
            this.statusType = 'info';

            // Setup WebSocket for telemetry
            const ws = new WebSocket('ws://localhost:8000/ws');
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                console.log('Telemetry event:', msg);
                this.handleTelemetry(msg);
            };
            ws.onopen = () => console.log('WebSocket connected');
            ws.onclose = () => console.log('WebSocket disconnected');

            await this.waitForServer();
            await this.fetchClips();
            await this.fetchSequences();
            this.status = 'Ready';
            this.statusType = 'info';
        },

        async waitForServer(maxAttempts = 20, delayMs = 300) {
            for (let i = 0; i < maxAttempts; i++) {
                try {
                    const r = await fetch('http://localhost:8000/');
                    if (r.ok) return;
                } catch (_) {}
                await new Promise(res => setTimeout(res, delayMs));
            }
        },

        handleTelemetry(msg) {
            if (msg.event === 'scan_started') {
                this.scanning = true;
                this.scanProgress = 0;
                this.status = 'Scanning…';
                this.statusType = 'info';
            } else if (msg.event === 'scan_progress') {
                this.scanProgress = msg.progress || 0;
                this.scanStatusText = `${msg.data.processed} / ${msg.data.total} · ${msg.data.current_file || ''}`;
            } else if (msg.event === 'scan_complete') {
                this.scanning = false;
                this.scanProgress = 100;
                this.status = `Scan complete · ${msg.data.new_clips} new · ${msg.data.skipped_clips || 0} skipped`;
                this.statusType = 'success';
                this.showToast(`Scan complete · ${msg.data.new_clips} new clips`, 'success');
                this.fetchClips();
                this.fetchSequences();
                setTimeout(() => { this.status = 'Ready'; this.statusType = 'info'; }, 4000);
            } else if (msg.event === 'clip_updated') {
                this.fetchClips();
            } else if (msg.event === 'sequence_updated') {
                if (msg.data.sequence_id === this.activeSequenceId) {
                    this.loadActiveSequence();
                }
                this.fetchSequences();
            } else if (msg.event === 'proxy_started') {
                this.proxyStatuses[msg.data.clip_id] = 'generating';
            } else if (msg.event === 'proxy_completed') {
                this.proxyStatuses[msg.data.clip_id] = 'completed';
                this.fetchClips();
            } else if (msg.event === 'proxy_failed') {
                this.proxyStatuses[msg.data.clip_id] = 'failed';
            } else if (msg.event === 'proxy_queue_started') {
                this.proxyQueueActive = true;
                this.proxyQueueTotal = msg.data.total || 0;
                this.proxyQueueProcessed = 0;
                this.proxyQueueFailed = 0;
                this.status = `Generating previews · 0 / ${this.proxyQueueTotal}`;
                this.statusType = 'info';
            } else if (msg.event === 'proxy_queue_progress') {
                this.proxyQueueActive = true;
                this.proxyQueueTotal = msg.data.total || 0;
                this.proxyQueueProcessed = msg.data.processed || 0;
                this.proxyQueueFailed = msg.data.failed || 0;
                this.status = `Generating previews · ${this.proxyQueueProcessed} / ${this.proxyQueueTotal}`;
                this.statusType = 'info';
            } else if (msg.event === 'proxy_queue_complete') {
                this.proxyQueueActive = false;
                const failed = msg.data.failed || 0;
                const total = msg.data.total || 0;
                const completed = msg.data.completed || 0;
                this.status = `Previews complete · ${completed} / ${total}${failed ? ` · ${failed} failed` : ''}`;
                this.statusType = failed ? 'error' : 'success';
                this.showToast(`Previews complete · ${completed} / ${total}${failed ? ` · ${failed} failed` : ''}`, failed ? 'error' : 'success');
                setTimeout(() => { this.status = 'Ready'; this.statusType = 'info'; }, 4000);
            }
        },

        // ───────────────────────────────
        // Selection & Playback
        // ───────────────────────────────

        async selectClip(clip) {
            console.log('Selecting clip:', clip);
            this.selectedClip = clip;
            this.markers = [];
            await this.fetchMarkers(clip.id);

            const player = this.$refs.player;
            if (player) {
                const handleMetadataLoaded = () => {
                    if (this.selectedClip) {
                        this.selectedClip.duration = player.duration;
                    }
                    player.removeEventListener('loadedmetadata', handleMetadataLoaded);
                };
                player.addEventListener('loadedmetadata', handleMetadataLoaded);
            }
        },

        get selectedClipIndex() {
            return this.sortedFilteredClips.findIndex(c => c.id === (this.selectedClip && this.selectedClip.id));
        },

        async selectNextClip() {
            const idx = this.selectedClipIndex;
            if (idx >= 0 && idx < this.sortedFilteredClips.length - 1) {
                await this.selectClip(this.sortedFilteredClips[idx + 1]);
            }
        },

        async selectPreviousClip() {
            const idx = this.selectedClipIndex;
            if (idx > 0) {
                await this.selectClip(this.sortedFilteredClips[idx - 1]);
            }
        },

        getPlayer() {
            return this.$refs.player || document.querySelector('video');
        },

        // ───────────────────────────────
        // Markers
        // ───────────────────────────────

        async fetchMarkers(clipId) {
            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/markers`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                this.markers = Array.isArray(data) ? data : [];
            } catch (error) {
                console.error('Error fetching markers:', error);
                this.markers = [];
            }
        },

        setMarkerStart() {
            const player = this.getPlayer();
            if (!player) return;
            this.pendingMarkerStart = player.currentTime;
        },

        cancelMarkerRange() {
            this.pendingMarkerStart = null;
        },

        async setMarkerEnd() {
            if (this.pendingMarkerStart === null) {
                this.showToast('Set a start time first', 'error');
                return;
            }
            if (!this.selectedClip) return;

            const player = this.getPlayer();
            const endTimestamp = player.currentTime;
            if (endTimestamp <= this.pendingMarkerStart) {
                this.showToast('End time must be after start time', 'error');
                return;
            }

            const note = await this.openMarkerNoteModal('Section Note');
            if (note === null) return;

            await this.saveMarker(this.pendingMarkerStart, endTimestamp, note);
            this.pendingMarkerStart = null;
        },

        async addSingleMarker() {
            if (!this.selectedClip) return;
            const player = this.getPlayer();
            const timestamp = player.currentTime;
            const note = await this.openMarkerNoteModal('Marker Note');
            if (note === null) return;
            await this.saveMarker(timestamp, null, note);
        },

        async saveMarker(timestamp, endTimestamp, note) {
            try {
                this.status = endTimestamp ? 'Adding section…' : 'Adding marker…';
                const response = await fetch(`http://localhost:8000/clips/${this.selectedClip.id}/markers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timestamp, end_timestamp: endTimestamp, note })
                });
                if (!response.ok) throw new Error(await response.text());
                await this.fetchMarkers(this.selectedClip.id);
                this.status = 'Ready';
            } catch (error) {
                console.error('Error adding marker:', error);
                this.showToast('Failed to add marker', 'error');
                this.status = 'Ready';
            }
        },

        openMarkerNoteModal(title) {
            this.markerNoteModalTitle = title;
            this.markerNoteDraft = '';
            this.markerNoteModalOpen = true;
            return new Promise((resolve) => { this.markerNoteResolve = resolve; });
        },

        submitMarkerNote() {
            if (this.markerNoteResolve) {
                this.markerNoteResolve(this.markerNoteDraft);
                this.markerNoteResolve = null;
            }
            this.markerNoteModalOpen = false;
        },

        closeMarkerNoteModal() {
            if (this.markerNoteResolve) {
                this.markerNoteResolve(null);
                this.markerNoteResolve = null;
            }
            this.markerNoteModalOpen = false;
        },

        async removeMarker(markerId) {
            if (!this.selectedClip) return;
            try {
                const response = await fetch(`http://localhost:8000/clips/${this.selectedClip.id}/markers/${markerId}`, { method: 'DELETE' });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                await this.fetchMarkers(this.selectedClip.id);
            } catch (error) {
                console.error('Error removing marker:', error);
                this.showToast('Failed to remove marker', 'error');
            }
        },

        seekTo(timestamp) {
            const player = this.getPlayer();
            if (player) player.currentTime = timestamp;
        },

        formatTime(seconds) {
            const date = new Date(0);
            date.setSeconds(seconds);
            return date.toISOString().substr(11, 8);
        },

        getMarkerRangeStyle(marker) {
            const duration = this.selectedClip?.duration || 1;
            const start = Math.max(0, Math.min(1, marker.timestamp / duration));
            const end = marker.end_timestamp ? Math.max(0, Math.min(1, marker.end_timestamp / duration)) : start;
            const left = start * 100;
            const width = Math.max(0.5, (end - start) * 100);
            return `left: ${left}%; width: ${width}%`;
        },

        // ───────────────────────────────
        // Culling
        // ───────────────────────────────

        async cullClip(clipId, action) {
            const clip = this.clips.find(c => c.id === clipId);
            if (!clip) return;

            let is_kept = clip.is_kept;
            let is_rejected = clip.is_rejected;

            if (action === 'keep') {
                is_kept = !is_kept;
                if (is_kept) is_rejected = false;
            } else if (action === 'reject') {
                is_rejected = !is_rejected;
                if (is_rejected) is_kept = false;
            } else if (action === 'clear') {
                is_kept = false;
                is_rejected = false;
            }

            // Optimistic update
            clip.is_kept = is_kept;
            clip.is_rejected = is_rejected;
            if (this.selectedClip && this.selectedClip.id === clipId) {
                this.selectedClip.is_kept = is_kept;
                this.selectedClip.is_rejected = is_rejected;
            }

            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/cull`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_kept, is_rejected })
                });
                if (!response.ok) throw new Error('Failed to update cull status');
            } catch (error) {
                console.error('Error culling clip:', error);
                this.showToast('Failed to update rating', 'error');
                // Revert
                await this.fetchClips();
            }
        },

        async cullSelected(action) {
            if (!this.selectedClip) return;
            await this.cullClip(this.selectedClip.id, action);
            if (action !== 'clear' && this.autoAdvance) {
                await this.selectNextClip();
            }
        },

        get autoAdvance() {
            return true;
        },

        get proxyQueuePercent() {
            if (!this.proxyQueueTotal) return 0;
            return Math.round((this.proxyQueueProcessed / this.proxyQueueTotal) * 100);
        },

        // ───────────────────────────────
        // Tags
        // ───────────────────────────────

        hasTag(clip, value) {
            return clip.tags && clip.tags.some(t => t.value === value);
        },

        async togglePresetTag(value) {
            if (!this.selectedClip) {
                this.showToast('Select a clip first', 'error');
                return;
            }
            const existing = this.selectedClip.tags.find(t => t.value === value);
            if (existing) {
                await this.removeTag(this.selectedClip.id, existing.id);
            } else {
                await this.addTag(this.selectedClip.id, 'creative', value);
            }
        },

        async addTag(clipId, tagType, value) {
            if (!value.trim()) return;
            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/tags`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tag_type: tagType, value: value })
                });
                if (!response.ok) throw new Error('Failed to add tag');
                this.newTagName = '';
                await this.fetchClips();
                if (this.selectedClip) await this.selectClip(this.selectedClip);
            } catch (error) {
                console.error('Error adding tag:', error);
                this.showToast('Failed to add tag', 'error');
            }
        },

        async removeTag(clipId, tagId) {
            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/tags/${tagId}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed to remove tag');
                await this.fetchClips();
                if (this.selectedClip) await this.selectClip(this.selectedClip);
            } catch (error) {
                console.error('Error removing tag:', error);
                this.showToast('Failed to remove tag', 'error');
            }
        },

        filterByTag(value) {
            this.tagFilter = value;
        },

        get allTags() {
            const values = new Set();
            this.clips.forEach(c => c.tags.forEach(t => values.add(t.value)));
            return Array.from(values).sort();
        },

        // ───────────────────────────────
        // Filtering
        // ───────────────────────────────

        get filteredClips() {
            // If query is active, clips are already filtered from the server
            return this.clips;
        },

        async applyQuery() {
            const query = this.queryFilter.trim();
            if (!query) {
                await this.fetchClips();
                return;
            }

            try {
                const url = new URL('http://localhost:8000/clips');
                url.searchParams.append('query', query);
                const response = await fetch(url);
                const result = await response.json();

                if (result.help) {
                    this.queryHelpContent = result.help;
                    this.queryHelpOpen = true;
                    return;
                }

                if (result.error) {
                    this.showToast(result.error, 'error');
                    return;
                }

                this.clips = result;
                if (this.selectedClip) {
                    const updatedClip = this.clips.find(c => c.id === this.selectedClip.id);
                    if (updatedClip) {
                        this.selectedClip = updatedClip;
                    } else {
                        this.selectedClip = null;
                    }
                }
            } catch (error) {
                console.error('Error applying query:', error);
                this.showToast('Query failed', 'error');
            }
        },

        async clearQuery() {
            this.queryFilter = '';
            this.acOpen = false;
            this.acIndex = -1;
            await this.fetchClips();
        },

        closeQueryHelp() {
            this.queryHelpOpen = false;
            this.queryHelpContent = '';
        },

        get sortedFilteredClips() {
            const clips = [...this.filteredClips];
            const dir = this.librarySortDir === 'asc' ? 1 : -1;
            clips.sort((a, b) => {
                if (this.librarySort === 'filename') {
                    return a.file_name.localeCompare(b.file_name) * dir;
                }
                if (this.librarySort === 'shortname') {
                    const aName = (a.short_name || a.file_name || '').toLowerCase();
                    const bName = (b.short_name || b.file_name || '').toLowerCase();
                    return aName.localeCompare(bName) * dir;
                }
                if (this.librarySort === 'date') {
                    const aDate = a.recorded_at ? new Date(a.recorded_at).getTime() : Infinity;
                    const bDate = b.recorded_at ? new Date(b.recorded_at).getTime() : Infinity;
                    if (aDate === bDate) return 0;
                    return (aDate - bDate) * dir;
                }
                return 0;
            });
            return clips;
        },

        formatRecordedAt(iso) {
            if (!iso) return '—';
            const d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            const pad = n => String(n).padStart(2, '0');
            return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },

        formatGps(value) {
            if (value === null || value === undefined || value === '') return null;
            const num = parseFloat(value);
            return isNaN(num) ? null : num.toFixed(4);
        },

        async updateClipMetadata(clipId, payload) {
            if (!clipId) return;
            try {
                this.status = 'Saving metadata…';
                const response = await fetch(`http://localhost:8000/clips/${clipId}/metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) throw new Error('Failed to update metadata');
                this.status = 'Ready';
            } catch (error) {
                console.error('Error updating metadata:', error);
                this.showToast('Failed to save metadata', 'error');
                this.status = 'Ready';
                await this.fetchClips();
            }
        },

        async saveSelectedClipMetadata() {
            if (!this.selectedClip) return;
            const payload = {
                short_name: this.selectedClip.short_name || null,
                recorded_at: this.selectedClip.recorded_at || null,
                latitude: this.selectedClip.latitude !== '' && this.selectedClip.latitude !== null ? parseFloat(this.selectedClip.latitude) : null,
                longitude: this.selectedClip.longitude !== '' && this.selectedClip.longitude !== null ? parseFloat(this.selectedClip.longitude) : null
            };
            await this.updateClipMetadata(this.selectedClip.id, payload);
        },

        // ───────────────────────────────
        // Scanning
        // ───────────────────────────────

        async chooseFolder() {
            if (window.electronAPI && window.electronAPI.selectFolder) {
                const folder = await window.electronAPI.selectFolder();
                if (folder) this.scanPath = folder;
            } else {
                this.showToast('Folder picker only available in Electron', 'error');
            }
        },

        async scanDirectory() {
            if (!this.scanPath) return;
            this.scanning = true;
            this.scanProgress = 0;
            this.status = 'Scanning…';
            try {
                const response = await fetch('http://localhost:8000/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: this.scanPath })
                });
                if (!response.ok) throw new Error(`Server responded with ${response.status}`);
                const result = await response.json();
                console.log('Scan result:', result);
                this.scanning = false;
                this.scanProgress = 100;
                this.status = `Scan complete · ${result.new_clips} new · ${result.skipped_clips || 0} skipped`;
                this.statusType = 'success';
                this.showToast(`Scan complete · ${result.new_clips} new clips`, 'success');
                await this.fetchClips();
                await this.fetchSequences();
                setTimeout(() => { this.status = 'Ready'; this.statusType = 'info'; }, 4000);
            } catch (error) {
                console.error('Error during scan:', error);
                this.scanning = false;
                this.status = 'Scan failed';
                this.statusType = 'error';
                this.showToast('Scan failed', 'error');
            }
        },

        async fetchClips() {
            try {
                const query = this.queryFilter.trim();
                const url = query
                    ? `http://localhost:8000/clips?query=${encodeURIComponent(query)}`
                    : 'http://localhost:8000/clips';
                const response = await fetch(url);
                const data = await response.json();
                if (!Array.isArray(data)) return;
                this.clips = data;
                if (this.selectedClip) {
                    const updatedClip = this.clips.find(c => c.id === this.selectedClip.id);
                    if (updatedClip) {
                        this.selectedClip = updatedClip;
                    } else {
                        this.selectedClip = null;
                    }
                }
            } catch (error) {
                console.error('Error fetching clips:', error);
            }
        },

        // ───────────────────────────────
        // Sequences / Blueprint
        // ───────────────────────────────

        async fetchSequences() {
            try {
                const response = await fetch('http://localhost:8000/sequences');
                this.sequences = await response.json();
                if (!this.activeSequenceId && this.sequences.length > 0) {
                    this.activeSequenceId = this.sequences[0].id;
                    await this.loadActiveSequence();
                }
            } catch (error) {
                console.error('Error fetching sequences:', error);
            }
        },

        openSequenceNameModal() {
            this.sequenceNameDraft = '';
            this.sequenceNameModalOpen = true;
            return new Promise((resolve) => { this.sequenceNameResolve = resolve; });
        },

        submitSequenceName() {
            if (this.sequenceNameResolve) {
                const name = this.sequenceNameDraft.trim();
                this.sequenceNameResolve(name || null);
                this.sequenceNameResolve = null;
            }
            this.sequenceNameModalOpen = false;
        },

        closeSequenceNameModal() {
            if (this.sequenceNameResolve) {
                this.sequenceNameResolve(null);
                this.sequenceNameResolve = null;
            }
            this.sequenceNameModalOpen = false;
        },

        async createSequence() {
            const name = await this.openSequenceNameModal();
            if (!name) return;
            try {
                const response = await fetch('http://localhost:8000/sequences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const sequence = await response.json();
                await this.fetchSequences();
                this.activeSequenceId = sequence.id;
                await this.loadActiveSequence();
            } catch (error) {
                console.error('Error creating sequence:', error);
                this.showToast('Failed to create sequence', 'error');
            }
        },

        async loadActiveSequence() {
            if (!this.activeSequenceId) {
                this.activeSequenceItems = [];
                return;
            }
            try {
                const response = await fetch(`http://localhost:8000/sequences/${this.activeSequenceId}/items`);
                this.activeSequenceItems = await response.json();
            } catch (error) {
                console.error('Error loading sequence items:', error);
                this.activeSequenceItems = [];
            }
        },

        async addClipToSequence(clipId, position = null) {
            if (!this.activeSequenceId) {
                this.showToast('Select or create a sequence first', 'error');
                return;
            }
            if (position === null) position = this.activeSequenceItems.length;
            try {
                await fetch(`http://localhost:8000/sequences/${this.activeSequenceId}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clip_id: clipId, position })
                });
                await this.loadActiveSequence();
            } catch (error) {
                console.error('Error adding clip to sequence:', error);
                this.showToast('Failed to add clip to sequence', 'error');
            }
        },

        async removeBlueprintItem(itemId) {
            if (!this.activeSequenceId) return;
            try {
                await fetch(`http://localhost:8000/sequences/${this.activeSequenceId}/items/${itemId}`, { method: 'DELETE' });
                await this.loadActiveSequence();
            } catch (error) {
                console.error('Error removing sequence item:', error);
                this.showToast('Failed to remove clip', 'error');
            }
        },

        async reorderBlueprint(itemIds) {
            if (!this.activeSequenceId) return;
            try {
                await fetch(`http://localhost:8000/sequences/${this.activeSequenceId}/reorder`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ item_ids: itemIds })
                });
                await this.loadActiveSequence();
            } catch (error) {
                console.error('Error reordering sequence:', error);
                this.showToast('Failed to reorder', 'error');
            }
        },

        dragClip(event, clip) {
            event.dataTransfer.setData('application/json', JSON.stringify({ type: 'clip', clipId: clip.id }));
            event.dataTransfer.effectAllowed = 'copy';
        },

        async dropOnBlueprint(event) {
            event.preventDefault();
            const data = event.dataTransfer.getData('application/json');
            if (!data) return;
            const payload = JSON.parse(data);
            if (payload.type === 'clip') {
                await this.addClipToSequence(payload.clipId);
            }
        },

        dragBlueprintItem(event, item) {
            event.dataTransfer.setData('application/json', JSON.stringify({ type: 'blueprint-item', itemId: item.id }));
            event.dataTransfer.effectAllowed = 'move';
        },

        dragOverBlueprintItem(event, targetItem) {
            event.preventDefault();
        },

        async dropBlueprintItem(event, targetItem) {
            event.preventDefault();
            event.stopPropagation();
            const data = event.dataTransfer.getData('application/json');
            if (!data) return;
            const payload = JSON.parse(data);
            if (payload.type !== 'blueprint-item') return;

            const draggedId = payload.itemId;
            if (draggedId === targetItem.id) return;

            const currentIds = this.activeSequenceItems.map(i => i.id);
            const fromIndex = currentIds.indexOf(draggedId);
            const toIndex = currentIds.indexOf(targetItem.id);
            if (fromIndex === -1 || toIndex === -1) return;

            const reordered = [...currentIds];
            reordered.splice(fromIndex, 1);
            reordered.splice(toIndex, 0, draggedId);
            await this.reorderBlueprint(reordered);
        },

        async exportStoryboard(sequenceId) {
            try {
                const markdown = await this.fetchStoryboardMarkdown(sequenceId);
                const blob = new Blob([markdown], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `storyboard_${sequenceId}.md`;
                a.click();
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Error exporting storyboard:', error);
                this.showToast('Export failed', 'error');
            }
        },

        async previewStoryboard(sequenceId) {
            try {
                this.markdownPreviewContent = await this.fetchStoryboardMarkdown(sequenceId);
                this.markdownPreviewOpen = true;
            } catch (error) {
                console.error('Error previewing storyboard:', error);
                this.showToast('Preview failed', 'error');
            }
        },

        closeMarkdownPreview() {
            this.markdownPreviewOpen = false;
            this.markdownPreviewContent = '';
        },

        async fetchStoryboardMarkdown(sequenceId) {
            const response = await fetch(`http://localhost:8000/sequences/${sequenceId}/export`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.text();
        },

        // ───────────────────────────────
        // Keyboard Handling
        // ───────────────────────────────

        handleGlobalKey(event) {
            // Ignore when typing in inputs/textareas
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
            if (this.markerNoteModalOpen || this.sequenceNameModalOpen || this.markdownPreviewOpen || this.shortcutHelpOpen) return;

            const key = event.key;

            // Shuttle — J/K/L (standard NLE transport)
            if (key === 'j' || key === 'J') {
                event.preventDefault();
                this.shuttle(-1);
                return;
            }
            if (key === 'l' || key === 'L') {
                event.preventDefault();
                this.shuttle(1);
                return;
            }
            if (key === 'k' || key === 'K') {
                event.preventDefault();
                this.stopShuttle();
                return;
            }

            // Navigation
            if (key === 'ArrowDown') {
                event.preventDefault();
                this.selectNextClip();
                return;
            }
            if (key === 'ArrowUp') {
                event.preventDefault();
                this.selectPreviousClip();
                return;
            }
            // Shift+Arrow for coarse 5s scrubbing — must come before bare Arrow checks
            if (key === 'ArrowRight' && event.shiftKey) {
                event.preventDefault();
                this.stepPlayer(5);
                return;
            }
            if (key === 'ArrowLeft' && event.shiftKey) {
                event.preventDefault();
                this.stepPlayer(-5);
                return;
            }
            if (key === 'ArrowRight') {
                event.preventDefault();
                this.stepPlayer(1);
                return;
            }
            if (key === 'ArrowLeft') {
                event.preventDefault();
                this.stepPlayer(-1);
                return;
            }
            if (key === 'Home') {
                event.preventDefault();
                const player = this.getPlayer();
                if (player) player.currentTime = 0;
                return;
            }

            // Markers — I/O/M (standard NLE)
            if (key === 'i' || key === 'I') {
                event.preventDefault();
                if (this.selectedClip) this.setMarkerStart();
                return;
            }
            if (key === 'o' || key === 'O') {
                event.preventDefault();
                if (this.selectedClip) this.setMarkerEnd();
                return;
            }
            if (key === 'm' || key === 'M') {
                event.preventDefault();
                if (this.selectedClip) this.addSingleMarker();
                return;
            }

            // Culling — P/X/U (Lightroom Pick/Reject/Unflag)
            if (key === 'p' || key === 'P') {
                event.preventDefault();
                this.cullSelected('keep');
                return;
            }
            if (key === 'x' || key === 'X') {
                event.preventDefault();
                this.cullSelected('reject');
                return;
            }
            if (key === 'u' || key === 'U') {
                event.preventDefault();
                this.cullSelected('clear');
                return;
            }

            // Close preview
            if (key === 'Escape') {
                event.preventDefault();
                this.closePreview();
                return;
            }

            // Tagging
            if (/^[1-9]$/.test(key)) {
                event.preventDefault();
                const index = parseInt(key, 10) - 1;
                if (index < this.tagPalette.length) {
                    this.togglePresetTag(this.tagPalette[index]);
                }
                return;
            }

            // Open location in Google Maps
            if (key === 'g' || key === 'G') {
                event.preventDefault();
                if (this.selectedClip && this.selectedClip.latitude !== null && this.selectedClip.latitude !== '' && this.selectedClip.longitude !== null && this.selectedClip.longitude !== '') {
                    const lat = this.selectedClip.latitude;
                    const lon = this.selectedClip.longitude;
                    window.open(`https://www.google.com/maps/search/${lat},${lon}/@${lat},${lon},10z`, '_blank');
                }
                return;
            }

            // Focus mode
            if (key === 'f' || key === 'F') {
                event.preventDefault();
                this.toggleFocusMode();
                return;
            }

            // Add selected clip to blueprint
            if (key === 'a' || key === 'A') {
                event.preventDefault();
                if (this.selectedClip) {
                    this.addClipToSequence(this.selectedClip.id);
                }
                return;
            }

            // Help
            if (key === '?') {
                event.preventDefault();
                this.openShortcutHelp();
            }
        },

        handlePlayerKey(event) {
            if (event.key === ' ') {
                event.stopPropagation();
            }
        },

        shuttle(direction) {
            const player = this.getPlayer();
            if (!player) return;
            if (this.shuttleSpeed === 0 || Math.sign(this.shuttleSpeed) !== direction) {
                this.shuttleSpeed = direction;
            } else {
                this.shuttleSpeed = Math.min(4, Math.max(-4, this.shuttleSpeed + direction));
            }
            this.applyShuttle();
        },

        stopShuttle() {
            const player = this.getPlayer();
            if (player) player.pause();
            this.shuttleSpeed = 0;
            if (this.shuttleTimeout) clearTimeout(this.shuttleTimeout);
        },

        applyShuttle() {
            const player = this.getPlayer();
            if (!player) return;
            if (this.shuttleSpeed === 0) {
                player.pause();
                return;
            }
            const rate = Math.pow(2, Math.abs(this.shuttleSpeed) - 1);
            player.playbackRate = rate;
            if (this.shuttleSpeed < 0) {
                // Reverse playback is not universally supported; step backward instead
                player.pause();
                const step = () => {
                    if (this.shuttleSpeed >= 0) return;
                    player.currentTime = Math.max(0, player.currentTime - 0.15 * Math.pow(2, Math.abs(this.shuttleSpeed) - 1));
                    this.shuttleTimeout = setTimeout(step, 100);
                };
                step();
            } else {
                if (this.shuttleTimeout) clearTimeout(this.shuttleTimeout);
                player.play();
            }
        },

        stepPlayer(seconds) {
            const player = this.getPlayer();
            if (player) player.currentTime = Math.max(0, player.currentTime + seconds);
        },

        toggleFocusMode() {
            this.focusMode = !this.focusMode;
        },

        closePreview() {
            this.selectedClip = null;
            this.markers = [];
            this.pendingMarkerStart = null;
        },

        openShortcutHelp() {
            this.shortcutHelpOpen = true;
        },

        // ───────────────────────────────
        // Toasts
        // ───────────────────────────────

        showToast(message, type = 'info') {
            const id = ++this.toastId;
            this.toasts.push({ id, message, type });
            setTimeout(() => {
                this.toasts = this.toasts.filter(t => t.id !== id);
            }, 3000);
        },

        // ───────────────────────────────
        // Query Autocomplete
        // ───────────────────────────────

        acTokenize(text) {
            const tokens = [];
            let i = 0;
            while (i < text.length) {
                if (/\s/.test(text[i])) { i++; continue; }
                if (text[i] === '"') {
                    const start = i++;
                    while (i < text.length && text[i] !== '"') {
                        if (text[i] === '\\') i++;
                        i++;
                    }
                    const closed = i < text.length;
                    if (closed) i++;
                    tokens.push({ type: 'STRING', value: text.slice(start, i), start, closed });
                    continue;
                }
                if (text[i] === '!' && text[i + 1] === '=') { tokens.push({ type: 'OP', value: '!=', start: i }); i += 2; continue; }
                if (text[i] === '>' && text[i + 1] === '=') { tokens.push({ type: 'OP', value: '>=', start: i }); i += 2; continue; }
                if (text[i] === '<' && text[i + 1] === '=') { tokens.push({ type: 'OP', value: '<=', start: i }); i += 2; continue; }
                if (text[i] === '=') { tokens.push({ type: 'OP', value: '=', start: i }); i++; continue; }
                if (text[i] === '>') { tokens.push({ type: 'OP', value: '>', start: i }); i++; continue; }
                if (text[i] === '<') { tokens.push({ type: 'OP', value: '<', start: i }); i++; continue; }
                if (text[i] === '(') { tokens.push({ type: 'LPAREN', value: '(', start: i }); i++; continue; }
                if (text[i] === ')') { tokens.push({ type: 'RPAREN', value: ')', start: i }); i++; continue; }
                if (text[i] === ',') { tokens.push({ type: 'COMMA', value: ',', start: i }); i++; continue; }
                if (/[a-zA-Z0-9_.]/.test(text[i])) {
                    const start = i;
                    while (i < text.length && /[a-zA-Z0-9_.]/.test(text[i])) i++;
                    tokens.push({ type: 'WORD', value: text.slice(start, i), start });
                    continue;
                }
                i++;
            }
            return tokens;
        },

        acParseContext(text) {
            const tokens = this.acTokenize(text);
            const endsWithSpace = text.length > 0 && /\s$/.test(text);
            const last = tokens[tokens.length - 1];
            const lastIsPartial = last && !endsWithSpace && (
                last.type === 'WORD' ||
                (last.type === 'STRING' && !last.closed)
            );

            let partial, replaceStart, fullTokens;
            if (!lastIsPartial) {
                partial = '';
                replaceStart = text.length;
                fullTokens = tokens;
            } else {
                partial = last.value;
                replaceStart = last.start;
                fullTokens = tokens.slice(0, -1);
            }

            let state = 'field';
            let field = null;

            for (const tok of fullTokens) {
                if (state === 'field') {
                    if (tok.type === 'WORD' && AC_FIELDS.includes(tok.value.toLowerCase())) {
                        field = tok.value.toLowerCase();
                        state = 'operator';
                    }
                } else if (state === 'operator') {
                    if (tok.type === 'OP') {
                        state = 'value';
                    } else if (tok.type === 'WORD') {
                        const v = tok.value.toUpperCase();
                        if (v === 'IN') state = 'in-open';
                        else if (v === 'NOT') state = 'not-in';
                    }
                } else if (state === 'not-in') {
                    if (tok.type === 'WORD' && tok.value.toUpperCase() === 'IN') state = 'in-open';
                } else if (state === 'in-open') {
                    if (tok.type === 'LPAREN') state = 'in-list';
                } else if (state === 'in-list') {
                    if (tok.type === 'STRING' || tok.type === 'WORD') state = 'in-after-value';
                    else if (tok.type === 'RPAREN') { state = 'connector'; field = null; }
                } else if (state === 'in-after-value') {
                    if (tok.type === 'COMMA') state = 'in-list';
                    else if (tok.type === 'RPAREN') { state = 'connector'; field = null; }
                } else if (state === 'value') {
                    if (tok.type === 'STRING' || tok.type === 'WORD') { state = 'connector'; field = null; }
                } else if (state === 'connector') {
                    if (tok.type === 'WORD' && ['and', 'or'].includes(tok.value.toLowerCase())) {
                        state = 'field';
                        field = null;
                    }
                }
            }

            return { state, field, partial, replaceStart };
        },

        acMatchesPartial(suggestion, partial) {
            if (!partial) return true;
            const strip = s => s.replace(/^"/, '').replace(/"$/, '').toLowerCase();
            return strip(suggestion).startsWith(strip(partial));
        },

        acComputeSuggestions() {
            const text = this.queryFilter;
            if (!text) { this.acOpen = false; return; }

            const ctx = this.acParseContext(text);
            this.acReplaceStart = ctx.replaceStart;
            const { state, field, partial } = ctx;

            let candidates = [];

            if (state === 'field') {
                candidates = AC_FIELDS
                    .filter(f => f.startsWith(partial.toLowerCase()))
                    .map(f => ({ display: f, insert: f, hint: 'field' }));
            } else if (state === 'operator') {
                const ops = AC_OPERATORS[field] || [];
                candidates = ops
                    .filter(op => op.toUpperCase().startsWith(partial.toUpperCase()))
                    .map(op => ({ display: op, insert: op, hint: 'operator' }));
            } else if (state === 'not-in') {
                if ('IN'.startsWith(partial.toUpperCase())) {
                    candidates = [{ display: 'IN', insert: 'IN', hint: 'keyword' }];
                }
            } else if (state === 'value' || state === 'in-list') {
                if (state === 'in-list' || field === 'tags') {
                    const tagValues = [...new Set(this.clips.flatMap(c => c.tags.map(t => t.value)))].sort();
                    candidates = tagValues
                        .filter(v => this.acMatchesPartial(v, partial))
                        .map(v => ({ display: v, insert: `"${v}"`, hint: 'tag' }));
                } else if (AC_VALUES[field]) {
                    candidates = AC_VALUES[field]
                        .filter(v => this.acMatchesPartial(v, partial))
                        .map(v => ({ display: v.replace(/"/g, ''), insert: v, hint: 'value' }));
                }
            } else if (state === 'connector') {
                candidates = ['AND', 'OR']
                    .filter(kw => kw.startsWith(partial.toUpperCase()))
                    .map(kw => ({ display: kw, insert: kw, hint: 'keyword' }));
            }

            if (candidates.length === 0) {
                this.acOpen = false;
            } else {
                this.acItems = candidates;
                this.acOpen = true;
                this.acIndex = -1;
            }
        },

        acSelect(item) {
            this.queryFilter = this.queryFilter.slice(0, this.acReplaceStart) + item.insert + ' ';
            this.acOpen = false;
            this.acIndex = -1;
            this.$nextTick(() => {
                const input = this.$refs.queryInput;
                if (input) {
                    input.focus();
                    input.setSelectionRange(this.queryFilter.length, this.queryFilter.length);
                }
                this.acComputeSuggestions();
            });
        },

        acHandleKey(event) {
            if (event.key === 'ArrowDown') {
                if (!this.acOpen) return;
                event.preventDefault();
                this.acIndex = Math.min(this.acIndex + 1, this.acItems.length - 1);
                this.$nextTick(() => document.querySelector('.ac-item--selected')?.scrollIntoView({ block: 'nearest' }));
            } else if (event.key === 'ArrowUp') {
                if (!this.acOpen) return;
                event.preventDefault();
                this.acIndex = Math.max(this.acIndex - 1, -1);
                this.$nextTick(() => document.querySelector('.ac-item--selected')?.scrollIntoView({ block: 'nearest' }));
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (this.acOpen && this.acIndex >= 0) {
                    this.acSelect(this.acItems[this.acIndex]);
                } else {
                    this.acOpen = false;
                    this.applyQuery();
                }
            } else if (event.key === 'Escape') {
                if (this.acOpen) {
                    event.preventDefault();
                    this.acOpen = false;
                    this.acIndex = -1;
                }
            } else if (event.key === 'Tab') {
                if (this.acOpen && this.acItems.length > 0) {
                    event.preventDefault();
                    const target = this.acIndex >= 0 ? this.acItems[this.acIndex] : this.acItems[0];
                    this.acSelect(target);
                }
            }
        }
    }));
});
