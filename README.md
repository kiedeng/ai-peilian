# AI Peilian

面向信贷业务培训场景的 AI 话术陪练系统。项目包含管理员配置后台、学员陪练入口、AI 客户对话、自动评分报告和运营看板，适合用于金融科技、信贷顾问、客服质检等训练场景的二次开发。

## Features

- 管理后台：活动配置、客户人设、标准话术、评分维度、发布管理
- 学员入口：活动列表、沉浸式文字/语音陪练、提交质检
- AI 能力：OpenAI-compatible 客户扮演、语音转写、语音合成、自动评分
- 报告中心：报告概览、评分详情、维度证据、合规风险、改进建议
- 数据看板：活动数、会话数、评分报告、平均分、维度均分、风险热词
- 数据存储：默认 SQLite，也可通过 `DATABASE_URL` 切换到 MySQL

## Tech Stack

- Backend: FastAPI, SQLAlchemy, Pydantic, Uvicorn
- Frontend: React, Vite, React Router, Lucide React
- Database: SQLite by default, MySQL compatible
- AI Provider: OpenAI-compatible HTTP API

## Quick Start

### 1. Clone

```bash
git clone https://github.com/kiedeng/ai-peilian.git
cd ai-peilian
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```bash
APP_SECRET_KEY=replace-with-a-random-secret
OPENAI_API_KEY=your_api_key
```

### 3. Start backend

```bash
conda create -n peilian python=3.11 -y
conda activate peilian
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 127.0.0.1 --port 8010 --reload
```

### 4. Start frontend

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`.

## Default Routes

- Student login: `http://127.0.0.1:5173/login`
- Activities: `http://127.0.0.1:5173/activities`
- Reports: `http://127.0.0.1:5173/reports`
- Admin login: `http://127.0.0.1:5173/admin/login`
- Admin activities: `http://127.0.0.1:5173/admin/activities`
- Review center: `http://127.0.0.1:5173/admin/reviews`
- Analytics: `http://127.0.0.1:5173/admin/analytics`
- Backend health check: `http://127.0.0.1:8010/healthz`

## Demo Accounts

The seed data creates demo users for local development:

- Admin: `admin` / `admin123`
- Student: `student` / `student123`

Change or remove these accounts before using the system outside a local demo environment.

## Environment Variables

See `.env.example` for the full list.

Common settings:

- `DATABASE_URL`: database connection string, defaults to local SQLite
- `APP_SECRET_KEY`: token signing secret
- `CORS_ORIGINS`: allowed frontend origins
- `OPENAI_API_KEY`: API key for the model provider
- `OPENAI_BASE_URL`: OpenAI-compatible API base URL
- `OPENAI_MODEL`: chat/scoring model
- `OPENAI_STT_MODEL`: speech-to-text model
- `OPENAI_TTS_MODEL`: text-to-speech model
- `OPENAI_TTS_VOICE`: text-to-speech voice

MySQL example:

```bash
DATABASE_URL=mysql+pymysql://user:password@127.0.0.1:3306/ai_peilian?charset=utf8mb4
```

## Development

Backend tests:

```bash
pytest backend/tests
```

Frontend build:

```bash
cd frontend
npm run build
```

## Security Notes

- Do not commit `.env`, database files, logs, pid files, uploaded assets, or generated builds.
- Use a strong `APP_SECRET_KEY` in deployed environments.
- Replace demo credentials before any non-local deployment.
- Configure CORS origins to match your actual frontend domains.

## License

This project is released under the MIT License. See `LICENSE` for details.
