# History and CSV exports

The Railway dashboard retains these exports:

- Scans CSV
- Signals CSV
- Baskets CSV
- Legs CSV
- Orders CSV
- Banking CSV

The clean default namespace is `v210`, so results from the old breakout and v2.00 engines do not mix with this fixed-ladder sample.

Orders CSV records all 16 ladder placements, cancellations and rejections. Legs CSV records every fill and close. Baskets CSV records peak, MAE, giveback and the final exit reason.
