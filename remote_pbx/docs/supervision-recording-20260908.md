# Supervision, reports and unified recordings

## Behavior

- ChanSpy/ExtenSpy and dedicated supervisor channels are removed before report leg grouping. This also excludes historical supervisor CDRs from reports, dashboards, exports and the recording library. Original CDRs and audit entries remain stored.
- New main recordings run continuously, including pre-bridge audio and hold intervals. Their recording reference is inherited by the called channel.
- The trusted originate helper creates a random one-use AstDB token. The isolated `pbx-supervision` context consumes it, marks its CDR and captures only incoming supervisor microphone audio during whisper/barge. Listen mode does not record the supervisor microphone.
- MixMonitor closes each source file before a completion timestamp is written. Completed durations and completion times align the supervisor tracks with the main recording. No second copy of the caller/operator audio is mixed in.
- Playback and download produce the same cached WAV. Original files are not rewritten. Range requests continue to work. The internal `.supervision` directory is excluded from the recording library. Only two mixing jobs run concurrently.
- Permissions and audit checks are performed before generating or returning the combined audio. A failed or incomplete mix is not silently replaced by the incomplete original.

## Deployment

Only PBX source, its dialplan and the `func_cut` module were changed. `pbx-UAI` was restarted; Asterisk received a dialplan reload, not a restart. No ports, firewall rules or other applications changed.

Backup: `backups/recording-supervision-20260908/` on the PBX host. Runtime requires `ffmpeg`, `ffprobe`, GNU `date`, `app_mixmonitor`, `app_chanspy`, `func_db` and `func_cut`. Source recordings, completion markers and `.supervision` microphone tracks must be backed up together; `data/recording-mixes` is a rebuildable cache and must not be exposed as a static directory.

## Validation

Controlled packaged-Electron call 701 -> 702, unique ID `1788878767.124`:

- Listen: both participants received zero supervisor audio.
- Whisper: only 702 received the 1 kHz supervisor tone (RMS approximately 0.104).
- Barge: both participants received that tone (RMS approximately 0.104).
- Switching back to listen and stopping supervision preserved the original call.
- Final main recording: 45.4 seconds, zero supervisor-tone windows before mixing.
- Unified recording: same duration, two distinct supervisor-tone segments, 25 detected 100 ms tone windows. Ordinary audio before supervision is unchanged.
- Authenticated HTTP playback/download both returned 200 with identical 726478-byte WAV bodies. Seeking returned 206. Report returned one business-call row and no supervisor rows.
- Scripts: `verify-monitor-live.cjs`, `verify-recording-mix.cjs`, `verify-recording-http.cjs`. Live scripts require explicitly authorized, free test extensions and an administrator password supplied only through the process environment.

## Limits

This captures supervisor speech for new calls after deployment. It cannot restore speech absent from older recordings. The tests cover the controlled internal call and mode switching, not every carrier, transfer topology or headset. The recording now includes pre-bridge media rather than compressing the timeline to bridged intervals only.

Upstream reference: [Asterisk 20.6 MixMonitor implementation](https://github.com/asterisk/asterisk/blob/20.6.0/apps/app_mixmonitor.c), which supports receive-only capture and completion commands. Whisper audiohooks are separate from the main MixMonitor capture.
