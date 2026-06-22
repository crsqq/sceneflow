document.addEventListener('alpine:init', () => {
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
        showTagInput: null,
        newTagName: '',

        sequences: [],
        activeSequenceId: '',
        activeSequenceItems: [],

        cullFilter: 'all',
        tagFilter: '',
        tagPalette: ['Wide', 'POV', 'Slow-Mo', 'Close-Up', 'B-Roll', 'Drone', 'Interview', 'Establishing'],

        focusMode: false,
        shortcutHelpOpen: false,

        markerNoteModalOpen: false,
        markerNoteModalTitle: 'Marker Note',
        markerNoteDraft: '',
        markerNoteResolve: null,

        markdownPreviewOpen: false,
        markdownPreviewContent: '',

        toasts: [],
        toastId: 0,

        // Shuttle state
        shuttleSpeed: 0,
        shuttleTimeout: null,

        async init() {
            console.log('SceneFlow App Initialized');

            // Setup WebSocket for telemetry
            const ws = new WebSocket('ws://localhost:8000/ws');
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                console.log('Telemetry event:', msg);
                this.handleTelemetry(msg);
            };
            ws.onopen = () => console.log('WebSocket connected');
            ws.onclose = () => console.log('WebSocket disconnected');

            // Initial fetch
            await this.fetchClips();
            await this.fetchSequences();
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
            return this.filteredClips.findIndex(c => c.id === (this.selectedClip && this.selectedClip.id));
        },

        async selectNextClip() {
            const idx = this.selectedClipIndex;
            if (idx >= 0 && idx < this.filteredClips.length - 1) {
                await this.selectClip(this.filteredClips[idx + 1]);
            }
        },

        async selectPreviousClip() {
            const idx = this.selectedClipIndex;
            if (idx > 0) {
                await this.selectClip(this.filteredClips[idx - 1]);
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
            return this.clips.filter(clip => {
                if (this.cullFilter === 'kept' && !clip.is_kept) return false;
                if (this.cullFilter === 'rejected' && !clip.is_rejected) return false;
                if (this.cullFilter === 'unreviewed' && (clip.is_kept || clip.is_rejected)) return false;
                if (this.tagFilter && !clip.tags.some(t => t.value === this.tagFilter)) return false;
                return true;
            });
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
                const response = await fetch('http://localhost:8000/clips');
                const newClips = await response.json();
                this.clips = newClips;
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
                this.status = 'Error fetching clips';
                this.statusType = 'error';
            }
        },

        // ───────────────────────────────
        // Sequences / Blueprint
        // ───────────────────────────────

        async fetchSequences() {
            try {
                const response = await fetch('http://localhost:8000/sequences');
                this.sequences = await response.json();
            } catch (error) {
                console.error('Error fetching sequences:', error);
            }
        },

        async createSequence() {
            const name = prompt('Sequence name:');
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
            if (this.markerNoteModalOpen || this.markdownPreviewOpen || this.shortcutHelpOpen) return;

            const key = event.key;

            // Shuttle
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

            // Culling
            if (key === 'k' || key === 'K') {
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

            // Tagging
            if (/^[1-9]$/.test(key)) {
                event.preventDefault();
                const index = parseInt(key, 10) - 1;
                if (index < this.tagPalette.length) {
                    this.togglePresetTag(this.tagPalette[index]);
                }
                return;
            }

            // Focus mode
            if (key === 'f' || key === 'F') {
                event.preventDefault();
                this.toggleFocusMode();
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
            const rate = Math.pow(2, Math.abs(this.shuttleSpeed));
            player.playbackRate = rate;
            if (this.shuttleSpeed < 0) {
                // Reverse playback is not universally supported; step backward instead
                player.pause();
                const step = () => {
                    if (this.shuttleSpeed >= 0) return;
                    player.currentTime = Math.max(0, player.currentTime - 0.15 * Math.pow(2, Math.abs(this.shuttleSpeed)));
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
        }
    }));
});
