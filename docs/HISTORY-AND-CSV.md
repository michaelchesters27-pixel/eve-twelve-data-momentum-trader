# History and CSV recording — v2.61

The data namespace remains `v220`, so the existing Railway history remains in the same collection names. Do not change `DATA_DIR`, delete the Railway volume, or change `BULLET_DATA_NAMESPACE` during deployment.

## Exports

- Campaigns CSV
- Bullets CSV
- BE events CSV
- Ladders CSV
- Replay CSV
- Orders CSV
- Banking CSV
- Market telemetry CSV

## v2.61 consistency rules

- Every record uses a campaign ID.
- Close-leg records recover campaign identity from their position identifier when necessary.
- Bullet counts are reconciled from unique OPEN position identifiers.
- Basket peak is forced to be at least the realised P/L.
- Giveback is recalculated as peak minus realised P/L.
- Every ladder creates 16 deterministic placement records.
- Duplicate record IDs are de-duplicated in memory after restart.
- Settings are snapshotted and versioned per campaign.

## Persistent controls

Railway writes both `v220-settings.json` and `v220-settings.backup.json` atomically under `DATA_DIR`. MT5 also stores the latest settings in terminal Global Variables and can restore Railway controls if both server files are missing.

## Basket peak fields

Campaigns and replay include:

- `basketPeakProtectionEnabled`
- `basketPeakActivationMoney`
- `basketPeakGivebackMoney`
- `basketPeakProtectionArmed`
- `basketPeakProtectionFloor`
- `settingsVersion`

Default v2.61 values are activation $4.00 and giveback $1.00.
