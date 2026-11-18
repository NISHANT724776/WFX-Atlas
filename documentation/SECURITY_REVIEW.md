# Security review

Scope: the knowledge server (`backend/`), its data (`knowledge/`, `database/`) and the platform pages. Date: 2026-11-16.

## What is protected and from whom

WFX specifications, change requests and business rules can be confidential. Threats considered: someone on the network
reading or changing knowledge; a malicious or malformed uploaded file; instructions hidden inside documents (prompt
injection); cross-site requests from another web page; leaking documents to an AI provider; losing knowledge.

## Controls in place

| Area | Control |
| --- | --- |
| Exposure | Binds to 127.0.0.1 by default (`WFX_HOST` to change). Static deployments (`.vercelignore`) exclude `knowledge/`, `database/`, `backend/`, `tests/`. |
| Accounts | Local users; scrypt hashes with per-user salt; timing-equalised login; password rules; first admin only with the one-time token printed in the server console. |
| Sessions | 32-byte random tokens stored only as SHA-256; HttpOnly, SameSite=Strict cookies (`Secure` with `WFX_SECURE_COOKIES=1` behind HTTPS); 12-hour sliding expiry; sessions removed when a user is disabled or changes password. |
| Roles | viewer < editor < approver < admin, checked on every route; only approvers can approve/activate; the last admin cannot be disabled or demoted. |
| Cross-site requests | Every state-changing request needs `X-Requested-With: wfx` (forces a CORS pre-flight) and a matching `Origin`. |
| Rate limits | Sign-in and setup 10 / 15 min per IP; questions 300 / hour per user; uploads 120 / hour per user. |
| Uploads | Extension allow-list, signature check (a renamed file is refused), 25 MB limit, empty files refused; originals stored under generated paths (`DOC-xxxx/vN/`), never overwritten (`wx` flag); ZIP entries capped against decompression bombs; nothing uploaded is executed; HTML scripts are dropped from extracted text. |
| Files | Path-traversal guard on static files and stored paths; downloads are `attachment` with a sanitised name. |
| Calculations | Restricted expression grammar parsed and evaluated by our code; formulas in TXT files are never run as code (tested with injection attempts). |
| Prompt injection | Documents are data: the model prompt marks sources as untrusted, only the passages of one answer are sent, citations are checked, and the platform's own status (not the model's) is shown. |
| AI confidentiality | Off unless a key is set **and** an admin records the organisation's approval in the app (recorded in the audit trail); never sends the library. |
| Headers | CSP (scripts from self plus exact hashes, `wasm-unsafe-eval` for SQLite in the browser), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`; API responses `Cache-Control: no-store`. |
| Audit | Sign-ins (and failures), users, uploads, downloads of originals, drafts, transitions, re-index, export, backup, AI settings. |
| Integrity | TXT writes are atomic (temp file + rename); history is append-only; every change is recorded in `metadata/change_history.json`. |
| Recovery | `POST /admin/backup` writes a consistent database copy (`VACUUM INTO`) and a zip of the knowledge folder; the index can be rebuilt from the TXT files and the registry. |

## Residual risks and recommendations

1. **No HTTPS in the server itself.** For use beyond one machine, put it behind a reverse proxy with TLS and set
   `WFX_SECURE_COOKIES=1`.
2. **Single sign-on is not integrated.** Local accounts only; SSO (Azure AD / Okta) would be a later addition.
3. **Data at rest is not encrypted** by the application. Use disk encryption on the host.
4. **Rate limits are per process** (in memory). Behind several instances, use the gateway's limits.
5. **Backups are local.** Copy `database/backups/` to separate storage; a restore has not been rehearsed.
6. **The v1 static site** (Vercel) has no authentication by design; it must not receive confidential content.
7. **Dependencies:** the server adds no npm packages; `npm audit` was not run in this session.

## Self-registration (added 2026-11-17)

- A new account made from the sign-in page is always a viewer; the request body cannot choose a role.
- Default policy: the account is created disabled and pending, and cannot sign in until an admin approves it. An admin can switch the feature off
  or open it (open = anybody who can reach the server reads the knowledge: only for a private network).
- Limits: 5 requests per hour per computer, at most 50 pending requests, passwords follow the existing policy (10+ characters, letters with digits or symbols).
- A wrong password for a pending account still answers "wrong user name or password"; the "waiting for approval" message is shown only when the password is right.
- Every sign-up, approval, rejection and mode change is audited. There is no email verification (no mail service), so approval is the control.
- The terminal recovery command (`npm run kb:user`) needs access to the server computer's database; the password is typed hidden and is never taken from arguments or files.

## Admin directory (added 2026-11-17)

- `knowledge/admin/users.txt` lists names, roles, status and creation date only. It is included in an admin's library export (the export is admin-only).
- Its passages are kind `admin_user`: `search()` filters them out unless `includeAdmin` is passed, and only an administrator's assistant request passes it.
  Everyone else's search, question and workflow generation cannot return them (tested).
- Editing the file by hand has no effect on accounts (it is regenerated); accounts exist only in the database.
