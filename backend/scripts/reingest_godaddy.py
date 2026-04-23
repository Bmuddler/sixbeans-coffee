"""One-shot re-ingest helper for saved GoDaddy Excel reports.

Walks a local outputs directory laid out as

    <root>/<YYYY-MM-DD>/godaddy_<store-uuid>_<YYYY-MM-DD>.xlsx

and POSTs each file to the analytics ingest endpoint. Use this after
correcting the UUID to location mapping so historical data lands on the
right store.

Before running, purge existing GoDaddy rows so the upsert writes fresh
data under the corrected locations:

    DELETE FROM daily_revenue WHERE channel = 'godaddy';

Usage:
    python reingest_godaddy.py \\
        --root "C:/Users/logca/Documents/Claude/Projects/GoDaddy Reports/outputs" \\
        --api-base https://sixbeans-api.onrender.com \\
        --cron-key <JWT_SECRET_KEY>
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import requests

FILENAME_RE = re.compile(
    r"^godaddy_(?P<uuid>[0-9a-f-]{36})_(?P<date>\d{4}-\d{2}-\d{2})\.xlsx$",
    re.IGNORECASE,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path,
                        help="Path to the outputs folder (contains dated subfolders).")
    parser.add_argument("--api-base", required=True,
                        help="Backend base URL, e.g. https://sixbeans-api.onrender.com")
    parser.add_argument("--cron-key", required=True,
                        help="Value of JWT_SECRET_KEY on the backend (sent as X-Cron-Key).")
    parser.add_argument("--dry-run", action="store_true",
                        help="List files that would be POSTed, do not send.")
    args = parser.parse_args()

    root: Path = args.root
    if not root.is_dir():
        print(f"ERROR: --root is not a directory: {root}", file=sys.stderr)
        return 2

    endpoint = args.api_base.rstrip("/") + "/api/analytics/admin/ingest/godaddy-excel"
    files = sorted(root.glob("*/godaddy_*.xlsx"))
    if not files:
        print(f"No files matched {root}/*/godaddy_*.xlsx")
        return 1

    ok = fail = skipped = 0
    for path in files:
        m = FILENAME_RE.match(path.name)
        if not m:
            print(f"SKIP  {path.name} (filename does not match expected pattern)")
            skipped += 1
            continue
        uuid = m.group("uuid")
        date = m.group("date")

        if args.dry_run:
            print(f"DRY   {date}  {uuid}  {path}")
            continue

        try:
            with path.open("rb") as fh:
                resp = requests.post(
                    endpoint,
                    headers={"X-Cron-Key": args.cron_key},
                    data={"store_uuid": uuid, "target_date": date},
                    files={"file": (path.name, fh,
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    timeout=60,
                )
        except requests.RequestException as exc:
            print(f"FAIL  {date}  {uuid}  network error: {exc}")
            fail += 1
            continue

        if resp.ok:
            data = resp.json()
            print(f"OK    {date}  {data.get('location'):25s}  "
                  f"gross=${data.get('gross_revenue'):>8.2f}  "
                  f"txns={data.get('transactions')}")
            ok += 1
        else:
            print(f"FAIL  {date}  {uuid}  HTTP {resp.status_code}  {resp.text[:200]}")
            fail += 1

    print(f"\nTotals: ok={ok} fail={fail} skipped={skipped} total={len(files)}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
