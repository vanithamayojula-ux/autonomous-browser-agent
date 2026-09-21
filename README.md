# Autonomous AI Browser Agent Web Application

![Security Status](https://img.shields.io/badge/Security-Data%20Protected-brightgreen)
![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-blue)
![Express](https://img.shields.io/badge/Backend-Express.js-lightgrey)
![Playwright](https://img.shields.io/badge/Automation-Playwright-green)
![License](https://img.shields.io/badge/License-MIT-blue)

A production-ready web application functioning as an autonomous AI-powered browser agent similar to **Antigravity**. Users input a high-level objective, and the agent plans, executes multi-step browser actions (navigating, typing, clicking, extracting text, taking screenshots), streams live step logs, and synthesizes final insights.

---

## 🏗️ System Architecture

```text
                                  ┌───────────────────────────┐
                                  │   Next.js Frontend UI     │
                                  │ (Objective, Logs, Result) │
                                  └─────────────┬─────────────┘
                                                │ HTTP / SSE Stream
                                                ▼
                                  ┌───────────────────────────┐
                                  │   Node.js + Express API   │
                                  └──────┬─────────────┬──────┘
                                         │             │
                    1. Plan Action Steps │             │ 3. Synthesize Text
                                         ▼             ▼
                              ┌───────────────────────────────┐
                              │     LLM API (Gemini / OpenAI) │
                              └───────────────────────────────┘
                                         │
                    2. Execute Steps     │
                                         ▼
                              ┌───────────────────────────────┐
                              │  Playwright Browser Engine    │
                              │ (Chromium, Page Automation)   │
                              └───────────────────────────────┘
```

---

## 📁 Repository Structure

```text
autonomous-browser-agent/
├── frontend/                     # Next.js 14 Frontend Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx       # Root layout & Tailwind setup
│   │   │   ├── page.tsx         # Main interactive dashboard UI
│   │   │   └── globals.css      # Custom styling & themes
│   │   └── components/
│   │       ├── LogViewer.tsx    # Terminal log viewer for step execution
│   │       └── ScreenshotModal.tsx # Fullscreen screenshot snapshot viewer
│   ├── package.json
│   └── tailwind.config.js
├── backend/                      # Node.js + Express Backend Server
│   ├── src/
│   │   ├── server.ts            # Server entry point & CORS
│   │   ├── routes/
│   │   │   └── agent.ts         # /api/agent/run & SSE /api/agent/stream
│   │   └── services/
│   │       └── aiPlannerService.ts # Gemini / OpenAI planning & summarizer
│   ├── package.json
│   └── tsconfig.json
├── agent/                        # Playwright Automation Engine
│   └── src/
│       ├── browserEngine.ts     # Resilient Playwright wrapper (goto, type, click, extract, screenshot)
│       └── executionEngine.ts   # Sequential step runner with retries & log emitter
├── prompts/                      # AI System Prompts
│   └── systemPrompt.ts          # Strictly enforced JSON planning & summary prompt templates
├── utils/                        # Utilities & Parsers
│   ├── jsonParser.ts            # Markdown stripper & JSON validator
│   └── security.ts              # Input sanitizer & safety constraints
├── docs/                         # Additional research & project blueprints
├── .env.example                  # Environment configuration template
├── SECURITY.md                   # Security policies
└── README.md                     # Comprehensive documentation
```

---

## ⚡ Local Setup & Execution Guide

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm** or **yarn**
* **Playwright Browsers**: Chromium binaries installed

### Step 1: Install Dependencies & Playwright
```bash
# Install root, backend, and frontend dependencies
npm run install:all

# Install Playwright browser binaries
npx playwright install chromium
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env` in the project root:
```bash
cp .env.example .env
```
Edit `.env` and supply your API key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
# OR
OPENAI_API_KEY=your_openai_api_key_here

PORT=3001
HEADLESS=true
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

### Step 3: Run Backend and Frontend
In terminal 1 (Backend Server):
```bash
cd backend
npm run dev
```
*Backend will run on `http://localhost:3001`.*

In terminal 2 (Frontend Dashboard):
```bash
cd frontend
npm run dev
```
*Frontend will run on `http://localhost:3000`.*

---

## 🔒 Security & Limits
* **Strict JSON Guard**: Markdown wrappers (` ```json `) are automatically stripped, validated against schema, and retried.
* **Maximum Step Limit**: Execution is capped at 12 steps per run to prevent infinite loops or excessive resource consumption.
* **Input Sanitization**: Rejects malformed or malicious inputs.
* **Zero Hardcoded Secrets**: Secrets are loaded strictly via environment variables. `.env` files are ignored by Git.

---

## 🚀 Deployment Suggestions

### 1. Frontend Deployment (Vercel / Netlify)
* Deploy `/frontend` directly to **Vercel**.
* Set environment variable: `NEXT_PUBLIC_BACKEND_URL=https://your-backend-server.com`.

### 2. Backend Server Deployment (Render / Railway / AWS EC2)
* Deploy `/backend` and `/agent` to a containerized platform supporting Chromium/Playwright (e.g., **Railway**, **Render**, or **Docker on AWS EC2**).
* Docker container command:
  ```dockerfile
  FROM mcr.microsoft.com/playwright:v1.45.0-jammy
  WORKDIR /app
  COPY . .
  RUN npm install
  RUN npm run build --prefix backend
  EXPOSE 3001
  CMD ["node", "backend/dist/server.js"]
  ```

---

## 📜 License
[MIT](LICENSE)
