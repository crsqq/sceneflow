document.addEventListener('alpine:init', () => {
        Alpine.data('app', () => ({
            status: 'Initializing...',
            scanPath: '/Users/crs/Desktop/test1/',
            clips: [],
            selectedClip: null,
            markers: [],
            pendingMarkerStart: null,
            markerNoteModalOpen: false,
            markerNoteModalTitle: 'Marker Note',
            markerNoteDraft: '',
            markerNoteResolve: null,
            markdownPreviewOpen: false,
            markdownPreviewContent: '',

            async init() {
            console.log('SceneFlow App Initialized');
            this.status = 'Ready';
            this.proxyStatuses = {};
            this.showTagInput = null;
            this.newTagName = '';
            this.sequences = [];

            // Setup WebSocket for telemetry
            const ws = new WebSocket('ws://localhost:8000/ws');
            ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                console.log('Telemetry event:', msg);
                if (msg.event === 'scan_complete') {
                    this.status = `Scan complete! Found ${msg.data.new_clips} new clips.`;
                    this.fetchClips();
                } else if (msg.event === 'clip_updated') {
                    this.fetchClips();
                } else if (msg.event === 'proxy_started') {
                    this.proxyStatuses[msg.data.clip_id] = 'generating';
                } else if (msg.event === 'proxy_completed') {
                    this.proxyStatuses[msg.data.clip_id] = 'completed';
                    this.fetchClips();
                } else if (msg.event === 'proxy_failed') {
                    this.proxyStatuses[msg.data.clip_id] = 'failed';
                }
            };
            ws.onopen = () => console.log('WebSocket connected');
            ws.onclose = () => console.log('WebSocket disconnected');

            // Initial fetch
            await this.fetchClips();
            await this.fetchSequences();
        },

        async selectClip(clip) {
            console.log('Selecting clip:', clip);
            this.selectedClip = clip;
            this.markers = []; 
            await this.fetchMarkers(clip.id);
            
            // Try to get video duration when clip is selected
            if (this.$refs.player) {
                const player = this.$refs.player;
                // Wait for metadata to load
                const handleMetadataLoaded = () => {
                    if (this.selectedClip) {
                        this.selectedClip.duration = player.duration;
                        // Remove event listener after first load
                        player.removeEventListener('loadedmetadata', handleMetadataLoaded);
                    }
                };
                player.addEventListener('loadedmetadata', handleMetadataLoaded);
                
                // Also set up a fallback in case metadata doesn't load
                setTimeout(() => {
                    if (this.selectedClip && !this.selectedClip.duration) {
                        // Try to get duration from video element if it's already loaded
                        if (player.duration && player.duration > 0) {
                            this.selectedClip.duration = player.duration;
                        }
                    }
                }, 1000);
            }
        },

        async fetchMarkers(clipId) {
            console.log('Fetching markers for clip:', clipId);
            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/markers`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                console.log('Fetched markers:', data);
                this.markers = Array.isArray(data) ? data : [];
            } catch (error) {
                console.error('Error fetching markers:', error);
                this.markers = [];
            }
        },

        getPlayer() {
            return this.$refs.player || document.querySelector('video');
        },

        setMarkerStart() {
            const player = this.getPlayer();
            if (!player) {
                alert('Error: Video player not found.');
                return;
            }
            this.pendingMarkerStart = player.currentTime;
            console.log('Marker start set:', this.pendingMarkerStart);
        },

        cancelMarkerRange() {
            this.pendingMarkerStart = null;
        },

        async setMarkerEnd() {
            if (this.pendingMarkerStart === null) {
                alert('Please set a start time first.');
                return;
            }
            if (!this.selectedClip) {
                alert('Please select a clip first.');
                return;
            }

            const player = this.getPlayer();
            if (!player) {
                alert('Error: Video player not found.');
                return;
            }

            const endTimestamp = player.currentTime;
            if (endTimestamp <= this.pendingMarkerStart) {
                alert('End time must be after start time.');
                return;
            }

            const note = await this.openMarkerNoteModal('Section Note');
            if (note === null) {
                // User cancelled; keep start pending so they can retry
                return;
            }

            await this.saveMarker(this.pendingMarkerStart, endTimestamp, note);
            this.pendingMarkerStart = null;
        },

        async addSingleMarker() {
            if (!this.selectedClip) {
                alert('Please select a clip first.');
                return;
            }

            const player = this.getPlayer();
            if (!player) {
                alert('Error: Video player not found.');
                return;
            }

            const timestamp = player.currentTime;
            const note = await this.openMarkerNoteModal('Marker Note');
            if (note === null) {
                return;
            }

            await this.saveMarker(timestamp, null, note);
        },

        async saveMarker(timestamp, endTimestamp, note) {
            try {
                this.status = endTimestamp ? 'Adding section...' : 'Adding marker...';
                const response = await fetch(`http://localhost:8000/clips/${this.selectedClip.id}/markers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        timestamp,
                        end_timestamp: endTimestamp,
                        note
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Backend error: ${response.status} - ${errorText}`);
                }

                await this.fetchMarkers(this.selectedClip.id);
                this.status = endTimestamp ? 'Section added' : 'Marker added';
                setTimeout(() => { this.status = 'Ready'; }, 2000);
            } catch (error) {
                console.error('Error adding marker/section:', error);
                this.status = 'Failed to add marker/section';
                alert(`Error: ${error.message}`);
            }
        },

        openMarkerNoteModal(title) {
            this.markerNoteModalTitle = title;
            this.markerNoteDraft = '';
            this.markerNoteModalOpen = true;
            return new Promise((resolve) => {
                this.markerNoteResolve = resolve;
            });
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
            console.log('Removing marker:', markerId);
            if (!this.selectedClip) return;
            try {
                const response = await fetch(`http://localhost:8000/clips/${this.selectedClip.id}/markers/${markerId}`, {
                    method: 'DELETE'
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

                console.log('Marker removed successfully');
                await this.fetchMarkers(this.selectedClip.id);
            } catch (error) {
                console.error('Error removing marker:', error);
                alert(`Failed to remove marker: ${error.message}`);
            }
        },

        seekTo(timestamp) {
            console.log('Seeking to:', timestamp);
            this.$refs.player.currentTime = timestamp;
        },

        formatTime(seconds) {
            const date = new Date(0);
            date.setSeconds(seconds);
            return date.toISOString().substr(11, 8);
        },

        getMarkerRangeStyle(marker) {
            const duration = this.selectedClip?.duration || 1;
            const start = Math.max(0, Math.min(1, marker.timestamp / duration));
            const end = marker.end_timestamp
                ? Math.max(0, Math.min(1, marker.end_timestamp / duration))
                : start;
            const left = start * 100;
            const width = Math.max(0.5, (end - start) * 100);
            return `left: ${left}%; width: ${width}%`;
        },

        async fetchSequences() {
            try {
                const response = await fetch('http://localhost:8000/sequences'); // Note: Need to add GET /sequences endpoint in main.py later if not exists, but let's assume it will be
                this.sequences = await response.json();
            } catch (error) {
                console.error('Error fetching sequences:', error);
            }
        },

        async createSequenceFromKept() {
            const keptClips = this.clips.filter(c => c.is_kept);
            if (keptClips.length === 0) {
                alert('No kept clips to sequence!');
                return;
            }

            this.status = 'Creating sequence...';
            try {
                const seqRes = await fetch('http://localhost:8000/sequences', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `Sequence ${new Date().toLocaleTimeString()}` })
                });
                const sequence = await seqRes.json();

                for (let i = 0; i < keptClips.length; i++) {
                    await fetch(`http://localhost:8000/sequences/${sequence.id}/items`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ clip_id: keptClips[i].id, position: i })
                    });
                }

                this.status = 'Sequence created!';
                await this.fetchSequences();
            } catch (error) {
                console.error('Error creating sequence:', error);
                this.status = 'Sequence creation failed';
            }
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
            }
        },

        async previewStoryboard(sequenceId) {
            try {
                this.markdownPreviewContent = await this.fetchStoryboardMarkdown(sequenceId);
                this.markdownPreviewOpen = true;
            } catch (error) {
                console.error('Error previewing storyboard:', error);
                this.status = 'Failed to load preview';
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

        async toggleKeep(clipId, currentState) {
            const newState = !currentState;

            // Optimistically update local state so the UI flips immediately
            const clip = this.clips.find(c => c.id === clipId);
            if (clip) {
                clip.is_kept = newState;
            }
            if (this.selectedClip && this.selectedClip.id === clipId) {
                this.selectedClip.is_kept = newState;
            }

            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/status?is_kept=${newState}`, {
                    method: 'POST'
                });
                if (!response.ok) throw new Error('Failed to update status');
            } catch (error) {
                console.error('Error toggling keep:', error);
                // Revert on error
                if (clip) clip.is_kept = currentState;
                if (this.selectedClip && this.selectedClip.id === clipId) {
                    this.selectedClip.is_kept = currentState;
                }
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
            } catch (error) {
                console.error('Error adding tag:', error);
            }
        },

        async fetchClips() {
            try {
                const response = await fetch('http://localhost:8000/clips');
                const newClips = await response.json();
                this.clips = newClips;

                // Maintain selection if the current clip is still in the list
                if (this.selectedClip) {
                    const updatedClip = this.clips.find(c => c.id === this.selectedClip.id);
                    if (updatedClip) {
                        this.selectedClip = updatedClip;
                    } else {
                        console.log('Selected clip no longer exists in the list.');
                        this.selectedClip = null;
                    }
                }
            } catch (error) {
                console.error('Error fetching clips:', error);
                this.status = 'Error fetching clips';
            }
        },

        async scanDirectory() {
            if (!this.scanPath) return;
            this.status = 'Scanning...';
            try {
                const response = await fetch('http://localhost:8000/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: this.scanPath })
                });

                if (!response.ok) {
                    throw new Error(`Server responded with ${response.status}`);
                }

                const result = await response.json();
                console.log('Scan result:', result);
                this.status = `Scan complete! Found ${result.new_clips} new clips.`;
                await this.fetchClips();
            } catch (error) {
                console.error('Error during scan:', error);
                this.status = 'Scan failed';
            }
        }
    }));
});
