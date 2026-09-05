# UX and softphone validation - 2026-09-04

## Published

- Web login branding, compact login mode selector and neutral light/dark surfaces.
- Short page-entry transitions, decorative signal animation and reduced-motion support.
- Only public/index.html and public/workspace.css were published. Backup: backups/login-ux-20260904. No service restart or port changes.

## Verified locally

- Web syntax checks and 57 tests passed.
- Three softphone state tests passed: SIP termination stage, authoritative pause state and invitation rejection.
- Web login screenshots at 390px and 1440px in both themes; no horizontal overflow; reduced-motion checked.
- Electron login launched with an isolated profile and rendered in both themes.
- Installer 1.0.3 built with the application icon.

## Pending release validation

- Backend pause serialization, queue pause database guard and logout cleanup are not deployed.
- Nearby save buttons and draft preservation are not deployed.
- Real two-extension registration, pause/resume, ringing cancellation and audio tests remain pending. Unit tests do not certify live calling.
- Module audit is incomplete. Extensions, queues, trunks, recordings and reports received visual inspection; this is not proof of complete functional coverage.
- Dependency installation reported 14 audit findings. They have not been triaged; no forced dependency upgrade was applied.

Do not describe this build as fully production-certified until the remaining telephony and module checks have completed.
