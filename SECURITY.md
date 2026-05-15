# Security Policy

## Supported Versions

Security fixes are handled on the latest `main` branch.

## Reporting a Vulnerability

Please report security issues privately to the repository owner. Do not open a public issue for vulnerabilities that expose secrets, authentication weaknesses, data leaks, or remote execution paths.

Include:

- A short description of the issue
- Steps to reproduce
- Affected files or endpoints
- Potential impact
- Suggested mitigation, if available

## Operational Guidance

- Never commit `.env` files or API keys.
- Change demo credentials before deployment.
- Use a strong `APP_SECRET_KEY`.
- Restrict `CORS_ORIGINS` to trusted frontend domains.
- Store production databases outside the repository.
