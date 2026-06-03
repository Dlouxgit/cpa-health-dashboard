# cpa-health-dashboard v0.1.0

## Highlights

- Consume `CLIProxyAPI / CPA` `usage-queue` directly
- Persist request events into local SQLite
- Show line health, OAuth account health, recent events, full error details, and token usage
- Support importing historical data from `CPA-Manager` SQLite

## Included in this release

- Line health table with success rate, failure streak, latency, and token usage
- OAuth / Auth File account health view
- Full error modal from live-collected events
- Current-window token summary in the header
- Local scripts for start / stop / status
- Open-source friendly config and README cleanup

## Notes

- `usage-queue` is a consumer queue; only one collector should consume it at a time.
- Do not commit `config.local.json`, `.env`, or any SQLite data files.
- Historical data imported from old `CPA-Manager` may already contain truncated error text.
