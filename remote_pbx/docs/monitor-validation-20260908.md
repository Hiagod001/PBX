# Live supervision validation - 2026-09-08

## Problems corrected

- ChanSpy was configured but not loaded. The control helper now checks the actual application output and loads the module when necessary, without restarting Asterisk.
- A monitored extension could resolve to the other party's channel because it appeared in the dial destination. Browser supervision now targets the exact PJSIP channel belonging to the selected extension, with ChanSpy's unique-channel option.
- Two browser contacts were registered on the shared supervisor endpoint. Origination now resolves the requesting browser's registered contact instead of dialing an arbitrary contact.
- Mode switching previously required stopping and restarting manually. One click now ends only the supervisor leg and reconnects in the selected mode while retaining SIP registration.
- Audio elements are preserved across dialog renders. Stale session events cannot clear a newer session. Missing incoming connections time out visibly.
- Starting another supervision session while one is active is rejected. Only the owning web session can stop application-managed supervision. This deployment supports one active browser supervision at a time on the shared endpoint.

## Evidence

Tests used a separate 701-to-702 call with synthetic audio. The original 581-to-505 call retained its channel IDs and bridge throughout the checks.

- Listen: supervisor received RTP; injected audio at both test endpoints measured RMS 0.
- Whisper targeting 702: received RMS approximately 0.104 at 702 and 0 at 701.
- Barge: received RMS approximately 0.104 at both endpoints.
- Mode switches preserved both call participants' established SIP sessions.
- The audio element retained its identity after a dialog render.
- 62 automated server/frontend tests passed locally.

The tests validate signaling and audio routing, not the acoustic quality of a particular physical headset. No customer audio was recorded or analyzed for this validation.

Deployment backup: `backups/monitor-20260908/source.tar.gz`. Only PBX application code/control helper changed; PM2 `pbx-UAI` was restarted, not Asterisk or unrelated services. No firewall or port changes.
