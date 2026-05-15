# Contributing

Thanks for your interest in improving AI Peilian.

## Development Setup

1. Create and activate a Python 3.11 environment.
2. Install backend dependencies:

```bash
pip install -r backend/requirements.txt
```

3. Install frontend dependencies:

```bash
cd frontend
npm install
```

4. Copy `.env.example` to `.env` and fill in local values.

## Checks

Run backend tests:

```bash
pytest backend/tests
```

Run frontend build:

```bash
cd frontend
npm run build
```

## Pull Requests

- Keep changes focused and explain the user-facing impact.
- Do not commit secrets, local databases, logs, uploaded files, pid files, caches, or build artifacts.
- Update documentation when behavior, setup, or configuration changes.
