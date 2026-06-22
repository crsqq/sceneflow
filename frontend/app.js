document.addEventListener('alpine:init', () => {
        Alpine.data('app', () => ({
             status: 'Initializing...',
             scanPath: '/Users/crs/Desktop/test1/',
             clips: [],
            selectedClip: null,
            markers: [],

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

        async addMarker() {
            console.log('Add Marker clicked');
            // Debug alert to confirm the function is called
            console.log('Attempting to add marker for clip:', this.selectedClip?.id);

            if (!this.selectedClip) {
                console.warn('No selected clip for adding marker');
                alert('Please select a clip first!');
                return;
            }

            // Try to find the video element via $refs or querySelector as a fallback
            const player = this.$refs.player || document.querySelector('video');
            console.log('Player element found:', player);

            if (!player) {
                console.error('Video player not found');
                alert('Error: Video player element could not be located.');
                return;
            }

            const timestamp = player.currentTime;
            console.log('Current video timestamp:', timestamp);

            const note = prompt('Enter marker note (optional):');
            if (note === null) {
                console.log('User cancelled marker note prompt');
                return; // User cancelled prompt
            }

            try {
                this.status = 'Adding marker...';
                console.log('Sending marker request to backend...');
                const response = await fetch(`http://localhost:8000/clips/${this.selectedClip.id}/markers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ timestamp, note })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Backend error: ${response.status} - ${errorText}`);
                }

                console.log('Marker added successfully');
                // Refresh markers for the current clip
                await this.fetchMarkers(this.selectedClip.id);
                this.status = 'Marker added';
                setTimeout(() => { this.status = 'Ready'; }, 2000);
            } catch (error) {
                console.error('Error adding marker:', error);
                this.status = 'Failed to add marker';
                alert(`Error adding marker: ${error.message}`);
            }
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
                const response = await fetch(`http://localhost:8000/sequences/${sequenceId}/export`);
                const markdown = await response.text();
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

        async toggleKeep(clipId, currentState) {
            try {
                const response = await fetch(`http://localhost:8000/clips/${clipId}/status?is_kept=${!currentState}`, {
                    method: 'POST'
                });
                if (!response.ok) throw new Error('Failed to update status');
            } catch (error) {
                console.error('Error toggling keep:', error);
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
