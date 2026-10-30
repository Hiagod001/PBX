# PBX storage

## Campaigns

With PostgreSQL enabled, `src/dialer-store.js` imports `data/dialer-campaigns.json`
once, in a transaction. It compares the reconstructed campaigns against the source
before committing the migration marker. Campaign metadata and individual leads
are stored separately; only changed leads are written. The legacy JSON is retained
as a migration backup and is no longer the live source. PostgreSQL dumps now include
campaigns, results and the migration marker. Audio recordings remain filesystem files.

The engine is still a single-process worker; do not run multiple PM2 instances of
the dialer. Before rollback to a JSON-based version, stop the panel, export the
current database campaigns using `dialerStore(file).read()` into an atomic JSON
snapshot with shape `{ campaigns }`, and only then restore the older application.
Do not replace current results with the original migration JSON.

Tests: `node --test tests/*.test.js`. Set `PBX_TEST_DATABASE_URL` to run the
PostgreSQL integration test. It uses temporary tables with `search_path=pg_temp`
and does not modify persistent campaign tables.

## Logs

Install `pbx-asterisk-logrotate` as `/etc/logrotate.d/pbx-asterisk`, and the matching
service/timer under `/etc/systemd/system/`. Validate with `logrotate -d` and
`systemd-analyze verify` before enabling the timer. The hourly check rotates logs
daily or above 50 MiB, keeps 14 rotations and compresses closed rotations. Only the
Asterisk logger is reloaded; telephony is not restarted. Existing legacy `.0.gz`,
`.1.gz`, `.2.gz` archives are retained separately, outside automatic deletion.

Recordings and CDR CSV files are deliberately excluded. Their retention requires
an explicit business policy and an independent backup; the database dump alone
does not back up audio. Inspect disk usage periodically because this VM also hosts
other applications.
