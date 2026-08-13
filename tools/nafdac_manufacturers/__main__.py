import argparse
import hashlib
from pathlib import Path

from .acquire import LISTING_URL, acquire_directory, write_snapshot
from .client import GreenbookClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Acquire the public NAFDAC Greenbook manufacturer directory")
    parser.add_argument("destination", type=Path, help="external .csv or .json snapshot path")
    parser.add_argument("--start-url", default=LISTING_URL)
    args = parser.parse_args()
    records = acquire_directory(GreenbookClient(), args.start_url)
    write_snapshot(records, args.destination)
    digest = hashlib.sha256(args.destination.read_bytes()).hexdigest()
    print(f"records={len(records)} sha256={digest} path={args.destination}")


if __name__ == "__main__":
    main()
