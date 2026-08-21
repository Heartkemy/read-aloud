#!/usr/bin/env python3
"""Markdown -> spoken prose, as a line-oriented service.

`normalize.py` is the library's single source of truth for what a passage
should sound like, and every engine has to agree with it — the neural one, the
system one, and whatever gets added next. Rather than a second copy in
JavaScript that drifts within a month, the Node side pipes text through this.

Standard library only, deliberately: it runs on whatever `python3` the machine
already has, with no virtualenv, so an app using only the macOS voices needs no
Python setup at all.

Protocol, one JSON object per line in and out:

    {"id": "7", "text": "**Hi** there", "read_code": false}
    {"id": "7", "text": "Hi there.", "leaks": []}

Run it directly to normalize stdin as plain text:

    echo '# Hello' | normalize_cli.py --plain
"""

from __future__ import annotations

import json
import sys

from normalize import leaked_syntax, normalize


def main() -> int:
    if "--plain" in sys.argv:
        sys.stdout.write(normalize(sys.stdin.read()))
        return 0

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as err:
            print(json.dumps({"error": f"bad request json: {err}"}), flush=True)
            continue

        try:
            spoken = normalize(
                request.get("text", ""),
                read_code=bool(request.get("read_code", False)),
            )
            body = {"text": spoken, "leaks": leaked_syntax(spoken)}
        except Exception as err:  # noqa: BLE001 - one bad passage must not end the service
            body = {"error": f"{type(err).__name__}: {err}"}
        print(json.dumps({"id": request.get("id"), **body}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
