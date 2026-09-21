# Security Policy & Data Protection Guidelines

## Security Practices
This repository follows strict data security and privacy practices:

1. **Zero Hardcoded Secrets**: No API keys, database credentials, passwords, or tokens are committed to this repository.
2. **Environment Variable Isolation**: All sensitive runtime values are loaded strictly via environment variables specified in `.env`.
3. **Ignore Policies**: Sensitive files, `.env` files, build artifacts, and vendor dependencies are excluded via `.gitignore`.
4. **Input Validation & Sanitization**: All API templates demonstrate input validation using schemas (Zod/Pydantic) to prevent SQL Injection, XSS, and payload manipulation.
5. **Secure Authentication**: Authentication blueprints mandate strong password hashing (`bcrypt`/`argon2`) and signed JWT tokens with short expiration windows.

## Reporting a Vulnerability
If you discover a security issue or credential leak, please do not open a public issue. Contact the repository maintainer directly.
