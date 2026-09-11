# 🧠 UniFlow: A Unified AI-Powered Personal Knowledge Management Platform

<p align="center">
  <img src="Thumbnail (2).png" alt="UniFlow: Unified AI-Powered Personal Knowledge Hub" width="850">
</p>

![Next.js](https://img.shields.io/badge/Next.js-16-black)
![MongoDB](https://img.shields.io/badge/MongoDB-Enabled-47A248)
![Groq](https://img.shields.io/badge/AI-Groq%20%7C%20Kimi%20K2-f36f21)
![Deepgram](https://img.shields.io/badge/Audio-Deepgram%20Nova--3-black)

UniFlow is a unified, full-stack AI-powered personal knowledge management platform designed to eliminate the fragmentation inherent in modern knowledge work. It acts as a single hub where web highlights, uploaded documents, meeting audio recordings, and AI-assisted conversations are automatically ingested, semantically indexed, and made queryable through an Advanced Retrieval-Augmented Generation (RAG) pipeline.

## ✨ Core Innovation: Semantic Contextualisation Layer (SCL)
Inspired by Anthropic's Contextual Retrieval (2024), UniFlow's **Semantic Contextualisation Layer (SCL)** prepends provenance-rich metadata (source type, title, tags, dates, participants) to every text chunk *before* indexing. This enables highly scoped retrieval across specific project or meeting contexts, demonstrating **retrieval accuracy improvements of 49–67%** over baseline RAG systems.

---

## 🚀 Key Features

*   **Multi-Modal Ingestion:** Automatically capture and index web highlights, documents (PDF, HTML, text), images (via OCR), and meeting audio.
*   **Meeting Intelligence:** Powered by Deepgram Nova-3 and Kimi K2, automatically transcribe audio with speaker diarisation, generate executive summaries, track topics, and extract structured action items.
*   **Advanced RAG Pipeline:** Features a 4-stage architecture (Query Rewriting → Hybrid BM25+Dense Retrieval → LLM Reranking → Grounded Generation) for highly accurate, citation-backed AI conversations.
*   **AI-Powered Note Organisation:** Automatically reorders captured highlights into logical reading sequences, classifies content (narrative/educational/historical), generates section headings, and creates flowchart nodes without altering original text.
*   **Workflow Unification:** Deep integrations with **Notion** (push notes and tasks) and **Google Drive** (import documents).
*   **Privacy First:** Field-level **AES-256-GCM encryption** at rest protects all sensitive notes, highlights, and conversations.

---

## 🏗️ System Architecture

UniFlow follows a highly structured **7-Layer Architecture**:
1.  **Client Interface:** Next.js 16 App Router (React 19) featuring 8 specialized routes (`/profile`, `/notes`, `/documents`, `/converse`, `/meet`, `/integrations`, `/settings`, `/login`).
2.  **Authentication:** PBKDF2 hashed passwords, cryptographic 256-bit session tokens, and Next.js edge middleware protection.
3.  **API Layer:** 25+ RESTful Next.js API endpoints grouped into Auth, Notes & Highlights, Documents & RAG, Meetings, Converse, Integrations, and Settings.
4.  **Service Layer:** Stateless domain logic processing chunking, index building, SCL contextual prefix generation, and API integrations.
5.  **AI Engine:** Unified LLM gateway to **Kimi K2 (via Groq)** and **Deepgram Nova-3**, featuring intelligent token budgeting and 429 retry logic with exponential backoff.
6.  **Data Layer:** **MongoDB** serving as the system of record with 15 specialized collections (e.g., `kb_notes`, `kb_chunks`, `meet_sessions`, `converse_sessions`).
7.  **Integration Layer:** Secure OAuth 2.0 flows connecting the platform to **Notion** and **Google Drive**.

---

## 🛠️ Technology Stack

| Category | Technologies Used |
| :--- | :--- |
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui |
| **Backend & API** | Node.js, Next.js API Routes, Next.js Middleware (Edge Runtime) |
| **Database & Search** | MongoDB, BM25 (Sparse), FNV-1a Hash Embeddings (384-d Dense) |
| **AI / LLM Backbone** | Kimi K2 (moonshotai/kimi-k2-instruct-0905) via Groq API |
| **Audio / ASR** | Deepgram Nova-3 (with speaker diarisation, entities, topics & sentiment) |
| **Security** | AES-256-GCM (Encryption at Rest), PBKDF2 (100k iterations, SHA-512) |
| **Document Processing** | `pdf-parse`, Mozilla Readability, DOMPurify, Tesseract.js (OCR) |
| **Markdown** | `react-markdown`, `remark-gfm` |

---

## 🔄 End-to-End User Flow

1.  **Capture (Stage 1):** Ingest data via Web Highlights (auto-consolidated per URL), Document Uploads, Meeting Audio, or AI Conversations.
2.  **Process & Index (Stage 2):** Text extraction → Knowledge signal extraction (Entities/Keywords/Actions via Kimi K2) → 800-char Chunking (150 overlap) → SCL Generation → 384-d Hash Embeddings.
3.  **Organize (Stage 3):** AI classifies content, restructures for logical reading, and generates summary metadata and meeting intelligence JSON.
4.  **Retrieve (Stage 4):** Query via `/converse` utilizing temporal detection, Query Rewriting (HyDE-lite), Hybrid Retrieval (RRF k=60), Feedback Boosting, LLM reranking, and strict source citations.
5.  **Connect & Export (Stage 5):** Push organized data seamlessly to Notion task databases or pages, or save Q&A chats as new notes.

---

## ⚙️ Local Development Setup

### Prerequisites
*   Node.js (v18+)
*   MongoDB Cluster (e.g., MongoDB Atlas)
*   API Keys for Groq and Deepgram

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/uniflow.git
   cd uniflow
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env.local` file in the root directory and add the following:
   ```env
   # Database
   MONGODB_URI=your_mongodb_connection_string

   # Security
   ENCRYPTION_KEY=your_32_byte_aes_key_base64
   
   # AI Providers
   GROQ_API_KEY=your_groq_api_key
   DEEPGRAM_API_KEY=your_deepgram_api_key

   # External Integrations (Optional)
   NOTION_CLIENT_ID=your_notion_client_id
   NOTION_CLIENT_SECRET=your_notion_client_secret
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   LIVE LINK:
  `https://assist-note-portal-5kfc.vercel.app/converse`

---

## 👥 Project Team
**Mini-Project 2025-26 | Department of Computer Science & Engineering**
**Rajiv Gandhi University of Knowledge Technologies, Nuzvid**

*   **Kolanukonda Jeevan** (N210838)
*   **Palagiri Mohammed Waafiq** (N210158)
*   **Mamidi Swathi** (N210219)
*   **Madem Nikhila** (N211092)

**Project Guide:** Mrs. Mathe Jerusha Blessy (Assistant Professor (C), Dept. of CSE)  
**Head of Department:** Mr. A. Udaya Kumar (Head of Department, Dept. of CSE)
