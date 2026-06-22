# Product Requirements Document (PRD): SceneFlow (MVP)

The Stack: Electron + Vanilla HTML/CSS + Alpine.js + Python (FastAPI sidecar).

**Product Vision:** To bridge the "organization gap" between production and post-production by providing a high-speed, local-first pre-visualization environment.

---

## 1. Executive Summary

### 1.1 Problem Statement
Semi-professional videographers suffer from a high "mental tax" during the transition from shooting to editing. Disorganized raw footage (varying formats, resolutions, and sources) requires hours of manual scrubbing to find specific narrative moments, creating friction between the creative intent (the script) and the technical execution (the edit).

### 1.2 Value Proposition
SceneFlow is a **Pre-Visualization Bridge**. It transforms disorganized raw media into a structured, annotated narrative blueprint. By utilizing a local-first architecture, it allows for high-speed inspection of heavy 4K files through automated proxy generation and a "Shadow Database" approach, enabling creators to move from raw footage to a sequenced storyboard ready for professional NLEs (Non-Linear Editors).

### 1.3 Core Design Principles
* **Data Gravity:** Keep heavy files on local high-speed storage; do not force uploads.
* **Non-Destructive Sovereignty:** The source media is strictly **Read-Only**. No files are renamed, moved, or altered.
* **Low Latency:** Prioritize instant scrubbing and rapid-fire tagging to match the user's creative flow.
* **Local-First Privacy:** All intelligence (tags, sequences, notes) remains on the user's machine.

---

## 2. Technical Architecture

### 2.1 System Model
* **Framework:** Desktop-Web Hybrid (Electron) to leverage local file system access with a fluid, high-performance web UI.
* **Data Management:** **The Shadow Database.** A local SQLite database stores all metadata, user annotations, tags, and sequence pointers. The app maps these "pointers" to the original files without modifying the source directory.
* **Media Engine:** 
    * **Ingestion:** Folder-based scanning (direct directory reading).
    * **Proxy Engine:** Background generation of low-resolution proxies (e.g., via FFmpeg) to facilitate smooth 4K playback within the UI.

---

## 3. Functional Requirements

### 3.1 Module: Ingestion & Media Processing
| ID | Requirement | Description |
| :--- | :--- | :--- |
| **FR.1** | **Folder Scan** | User selects a local directory; the app recursively scans for video files without moving or renaming them. |
| **FR.2** | **Automated Metadata Extraction** | Upon scan, the system must extract technical metadata: Resolution, Frame Rate, and Orientation/Aspect Ratio. |
| **FR.3** | **Background Proxy Generation** | System automatically generates low-res proxies for all ingested media to ensure lag-free scrubbing. |
| **FR.4** | **Immediate Inspection** | Users must be able to preview and tag footage using existing files or low-res proxies *while* high-quality proxies are still being generated in the background. |

### 3.2 Module: The Tagging Engine (Metadata)
The engine supports two distinct layers of metadata to facilitate rapid searching.

#### A. Automated Technical Metadata (System-Generated)
* Auto-categorization by resolution (e.g., 4K vs 1080p), orientation (Vertical vs Horizontal), and frame rate.

#### B. Manual Creative Metadata (User-Generated)
* **Aesthetic & Shot Type:** A rapid-entry system for the creator to tag clips by movement or vibe (e.g., *"Orbit," "Pan," "Static," "Golden Hour,"* or *"Overcast"*).

### 3.3 Module: The Two-Stage Creative Workflow
The UI must support two distinct modes to mirror the creator's mental progression.

#### Stage 1: Culling (The "Filter")
* **Objective:** Rapid elimination of unusable media.
* **Functionality:** A high-speed interface where users quickly mark clips as **"Keep"** or **"Discard."** 
* **UX Goal:** Minimize clicks; allow for rapid-fire decision-making to clear out shaky or poorly lit shots.

#### Stage 2: Storyboarding (The "Sequence")
* **Objective:** Establishing narrative intent.
* **Functionality:** A timeline/sequence view where "Kept" clips are dragged into a specific order.
* **Annotation:** Users can attach text-based notes to clips or transitions (e.g., *"Transition from mountain peak to forest floor here"*) to serve as a blueprint for the edit.

### 3.4 Module: The Export Bridge (NLE Integration)
* **Requirement:** Generate a structured export file based on the **Storyboarding Stage**.
* **Supported Formats:** XML or EDL (Edit Decision List).
* **Target Integration:** Must be importable into professional NLEs (e.g., DaVinci Resolve, Shotcut).
* **Expected Result:** Upon import, the NLE timeline should contain only the "Kept" clips, arranged in the specific sequence and order defined within SceneFlow.

---

## 4. Non-Functional Requirements

### 4.1 Performance
* **Scrubbing Latency:** Video playback/scrubbing via proxies must be near-instantaneous.
* **Ingestion Speed:** The initial folder scan and metadata extraction must be non-blocking (running in the background).

### 4.2 Data Integrity & Privacy
* **Read-Only Mandate:** The application must have no write-permissions for the source media directories.
* **Data Portability:** The SQLite Shadow Database should be easily portable or backed up by the user.

### 4.3 Usability
* **Mental State Alignment:** The UI must clearly distinguish between the "Culling" mindset (fast/decisive) and the "Storyboarding" mindset (thoughtful/creative).