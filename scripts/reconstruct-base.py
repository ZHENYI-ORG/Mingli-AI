#!/usr/bin/env python3
"""Reassemble Qwen3.8-27B files downloaded from this repository's Release."""

import hashlib
import json
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 scripts/reconstruct-base.py ASSET_DIR OUTPUT_DIR")
    assets = Path(sys.argv[1])
    output = Path(sys.argv[2])
    manifest = json.loads((assets / "base-manifest.json").read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)

    for item in manifest["files"]:
        name = item["name"]
        if Path(name).name != name:
            raise ValueError(f"Unsafe file name: {name}")
        target = output / name
        total_hash = hashlib.sha256()
        total_size = 0
        with target.open("wb") as destination:
            for part in item["assets"]:
                part_name = part["name"]
                if Path(part_name).name != part_name:
                    raise ValueError(f"Unsafe asset name: {part_name}")
                part_hash = hashlib.sha256()
                part_size = 0
                part_path = assets / part_name
                if part_name == ".gitattributes" and not part_path.exists():
                    part_path = assets / "default.gitattributes"
                with part_path.open("rb") as source:
                    for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                        part_hash.update(block)
                        total_hash.update(block)
                        part_size += len(block)
                        destination.write(block)
                if part_size != part["size"] or part_hash.hexdigest() != part["sha256"]:
                    target.unlink(missing_ok=True)
                    raise ValueError(f"Corrupt release asset: {part_name}")
                total_size += part_size
        if total_size != item["size"] or total_hash.hexdigest() != item["sha256"]:
            target.unlink(missing_ok=True)
            raise ValueError(f"Corrupt reconstructed file: {name}")
        print(f"Verified {name}")


if __name__ == "__main__":
    main()
