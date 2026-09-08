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

## Follow-up release 1.0.4

The follow-up adds an animated line background behind a framed login form in both applications. Canvas rendering is capped at 20 frames per second and pixel density at 1.5. It stops when the login is hidden, the document is in the background, or reduced motion is enabled. Theme changes redraw the static background as needed.

The pending backend and nearby-save changes above are now published. Backup: `backups/ux-validation-20260905`. Only `pbx-UAI` was restarted. Only the changed `extensions.conf` was installed and the dialplan reloaded; no port, firewall, trunk credential, or unrelated service changes were made.

### Verified

- 60 web/server tests passed locally and on the VM; three softphone unit tests passed.
- All 14 modules rendered in both themes with fixture data. All 14 production pages loaded without JavaScript errors or failed API responses during the smoke test.
- Scoped extension save sent only the extensions section. Typing during the pending request preserved the later draft while the baseline reflected the saved value.
- URA creation, independent options, submenu positioning, editable inbound routes and final destinations passed the browser regression script.
- Login screenshots passed at 390px and 1440px. Canvas pixels changed during animation and remained still with reduced motion.
- The final packaged 1.0.4 executable passed real registration on 505 and 701, pause status, rejection while paused, resume, ringing cancellation, answer, bidirectional RTP, hangup, repeat hangup, transport reconnection, and logout/relogin while paused.
- During answered internal calls, the server exposed active channels for both extensions.
- A single authorized external test used the configured trunk. The softphone received 931 RTP packets and sent 968 at the sample point. The Asterisk CDR recorded ANSWERED and 19 billable seconds. Human confirmation of perceived audio is separate from these measurements.
- Final Asterisk state: zero active channels/calls, no remaining UAI_PAUSED entries for tests. Production error log was empty when checked.

### Fixes found during tests

- Pause state could disappear while registration status was briefly stale. Persisted pause is authoritative, mutations are serialized and cached status is invalidated.
- The SIP hangup could finish before the server fallback ran. Hangup now reads fresh status and treats already-ended calls as success without allowing control of another extension's live channel.
- Startup could overwrite a quickly typed extension with the remembered extension. Prefill now happens before asynchronous initialization and login remains disabled until initialization finishes.

### Limits

- Audio tests used Chromium's synthetic microphone. They validate signaling and packet flow, not the user's physical microphone/headset or subjective audio quality.
- The eight-hour rolling session configuration was inspected; an eight-hour endurance test was not run.
- Production module checks were read-only. Destructive workflows and external dialer campaigns were not executed against customer data. Save behavior was tested with isolated fixtures.
- The installer was built and its packaged executable exercised; an interactive install/upgrade over the user's existing installation was not performed.
- Previously reported development/build dependency advisories remain untriaged. An audit excluding dev dependencies reported none, but that does not assess the bundled Electron runtime.

Final installer SHA256: `19ae1b765f2865b003914fad3143dc2af8c3dcb1e2bf4c86587cc62cb92e29f8`.
