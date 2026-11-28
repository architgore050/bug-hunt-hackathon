#!/usr/bin/env python3
"""Two-tree build pipeline for the Papyrus challenge (RESTRICTED).

papyrus-reference/ (clean, tested)  ->  challenge-app/ (generated, injected)

Steps (spec 3.2):
  1. wipe + copy the reference tree
  2. apply injection-manifest.json patches in order (loud failure on drift)
  3. generate the Level 1 test-case runner, hints and repair set from the manifest
  4. run the leakage lint over the participant tree
  5. write challenge-app/PARTICIPANT_FILES.json from the actual tree
  6. resolve anchors to line ranges + 3-line window hashes -> organizer/gt-manifest.json
  7. generate organizer/hidden_tests/ and organizer/answer-key.md
  8. build the side quest pack + HMAC flag manifest
  9. run the gates (npm test on both trees, hidden tests red/green)
 10. print the diff summary for the two-reviewer audit

Usage: python scripts/build_papyrus_challenge.py [--skip-tests] [--sidequests-only]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REFERENCE = REPO / "papyrus-reference"
OUTPUT = REPO / "challenge-app"
ORGANIZER = REPO / "organizer"
MANIFEST_PATH = ORGANIZER / "injection-manifest.json"
BACKEND = REPO / "backend"

TC_TEMPLATE = """"use strict";
// Generated Level 1 check {tc_id}: {title}
// Each check prints a symptom and an assertion; a failing check is a bug to
// report, not a broken test. Run all of them with: npm run tc:l1
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {{ pathToFileURL }} = require("node:url");

const APP_ROOT = path.resolve(__dirname, "..", "..", "..");
const {{ startApp, registerUser, cookieMaxAge }} = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("{tc_id}: {title}", async () => {{
  const app = await startApp();
  try {{
{body}
  }} finally {{
    await app.close();
  }}
}});
"""

HIDDEN_TEMPLATE = """"use strict";
// Organizer-side hidden test for {ticket} ({gt_code}). Generated artifact.
// Gate: fails on the injected build, passes on the repaired reference build.
process.env.PAPYRUS_DB = ":memory:";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {{ pathToFileURL }} = require("node:url");

const APP_ROOT = process.env.APP_ROOT;
if (!APP_ROOT) {{
  throw new Error("Set APP_ROOT to the challenge tree under test.");
}}
const {{ startApp, registerUser, cookieMaxAge }} = require(path.join(APP_ROOT, "test", "helpers", "http.js"));

test("{hidden_id}: {title}", async () => {{
  const app = await startApp();
  try {{
{body}
  }} finally {{
    await app.close();
  }}
}});
"""

LINT_TOKENS = ["BUG-", "FLAG{", "answer key", "answer-key", "ground truth", "decoy patch", "root-cause"]
# Award-unit codes and flag markers are uppercase; check them case-sensitively
# so dependency names like the `debug` package do not trip the lint.
LINT_CASE_SENSITIVE = {"BUG-", "FLAG{"}
LINT_SKIP_DIRS = {"node_modules", "data", ".git"}
HINTS_HEADER = """# Level 1 hints

One hint per check, phrased at concept level. Hints never name a file or a
line. Match the hint number to the check number from `npm run tc:l1`.
"""


def fail(msg: str) -> None:
    print(f"BUILD FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


def run(cmd: list[str], cwd: Path, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True, text=True)
    if check and proc.returncode != 0:
        fail(f"command {' '.join(cmd)} exited {proc.returncode} in {cwd}\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}")
    return proc


def copy_tree() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    shutil.copytree(
        REFERENCE,
        OUTPUT,
        ignore=shutil.ignore_patterns("node_modules", "data", "*.log"),
    )
    # The generated tree gets its own dependency install so every gate (and
    # every hidden test run) exercises real code, never module-not-found.
    proc = run(["npm", "ci", "--no-audit", "--no-fund"], cwd=OUTPUT, check=False)
    if proc.returncode != 0:
        run(["npm", "install", "--no-audit", "--no-fund"], cwd=OUTPUT)


def apply_patches(manifest: dict) -> list[dict]:
    applied = []
    for entry in manifest["entries"]:
        for patch in entry["patches"]:
            target = OUTPUT / patch["file"]
            if not target.exists():
                fail(f"{entry['ticket']}: patch target missing: {patch['file']}")
            text = target.read_text(encoding="utf-8")
            needle = patch["find"]
            count = text.count(needle)
            if count == 0:
                fail(f"{entry['ticket']}: find text not found in {patch['file']}:\n{needle[:200]}")
            if count > 1:
                fail(f"{entry['ticket']}: find text matches {count} times in {patch['file']}:\n{needle[:200]}")
            target.write_text(text.replace(needle, patch["replace"], 1), encoding="utf-8")
            applied.append({"ticket": entry["ticket"], "file": patch["file"], "changed": needle != patch["replace"]})
    return applied


def generate_level1_files(manifest: dict) -> None:
    cases = OUTPUT / "test" / "cases" / "level1"
    cases.mkdir(parents=True, exist_ok=True)
    hints = [HINTS_HEADER]
    for entry in manifest["entries"]:
        if entry["level"] != 1 or not entry.get("tc"):
            continue
        tc = entry["tc"]
        body = tc["body"].strip("\n")
        (cases / f"{tc['id']}.test.js").write_text(
            TC_TEMPLATE.format(tc_id=tc["id"], title=tc["title"], body=body),
            encoding="utf-8",
        )
        hints.append(f"{tc['id']}. {tc['tc_hint']}")
    (OUTPUT / "hints" / "L1_HINTS.md").write_text("\n".join(hints) + "\n", encoding="utf-8")

    repair = [entry for entry in manifest["entries"] if entry.get("repair_set")]
    lines = [
        "# Repair set R",
        "",
        "Fix these ten tickets in the editable workspace. Verify every change",
        "against the documented behaviour (README.md, docs/API.md) before you",
        "submit. The side quest pack is optional, is not part of this repository,",
        "and awards capped bonus points.",
        "",
    ]
    for entry in repair:
        lines.append(f"- {entry['ticket']} - {entry['participant_title']} ({entry['points']} points)")
    (OUTPUT / "REPAIR_SET.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def leakage_lint() -> None:
    hits = []
    for path in sorted(OUTPUT.rglob("*")):
        if not path.is_file():
            continue
        if any(part in LINT_SKIP_DIRS for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for token in LINT_TOKENS:
            leaked = token in text if token in LINT_CASE_SENSITIVE else token in text.lower()
            if leaked:
                hits.append(f"{path.relative_to(OUTPUT)}: contains {token!r}")
    for banned in ["ORGANIZER_ANSWER_KEY.md", "answer-key.md"]:
        if (OUTPUT / banned).exists():
            hits.append(f"{banned} must not exist in the participant tree")
    if hits:
        fail("leakage lint:\n" + "\n".join(hits))


def participant_files() -> list[str]:
    skip_files = {"PARTICIPANT_FILES.json"}
    files = []
    for path in sorted(OUTPUT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(OUTPUT).as_posix()
        if any(part in LINT_SKIP_DIRS for part in path.parts):
            continue
        if rel in skip_files:
            continue
        files.append(rel)
    (OUTPUT / "PARTICIPANT_FILES.json").write_text(
        json.dumps({"generated_by": "scripts/build_papyrus_challenge.py", "files": files}, indent=2) + "\n",
        encoding="utf-8",
    )
    return files


def anchor_hash(path: Path, lineno: int) -> str:
    lines = path.read_text(encoding="utf-8").splitlines()
    window = "\n".join(lines[max(0, lineno - 2) : lineno + 1])
    return hashlib.sha256(window.encode()).hexdigest()


def resolve_anchors(manifest: dict) -> dict:
    bugs = []
    for entry in manifest["entries"]:
        locations = []
        for anchor in entry["anchors"]:
            target = OUTPUT / anchor["file"]
            if not target.exists():
                fail(f"{entry['ticket']}: anchor file missing in injected tree: {anchor['file']}")
            lines = target.read_text(encoding="utf-8").splitlines()
            lineno = next((i for i, line in enumerate(lines, start=1) if anchor["pattern"] in line), None)
            if lineno is None:
                fail(f"{entry['ticket']}: anchor pattern not found in {anchor['file']}: {anchor['pattern']!r}")
            occurrences = sum(1 for line in lines if anchor["pattern"] in line)
            if occurrences > 1:
                fail(f"{entry['ticket']}: anchor pattern matches {occurrences} lines in {anchor['file']}")
            locations.append(
                {
                    "file_path": anchor["file"],
                    "line_start": max(1, lineno - 1),
                    "line_end": lineno + 1,
                    "primary": bool(anchor["primary"]),
                    "anchor_hash": anchor_hash(target, lineno),
                    "pattern": anchor["pattern"],
                }
            )
        if entry["level"] == 1 and (len(locations) != 1 or not locations[0]["primary"]):
            fail(f"{entry['ticket']}: Level 1 units carry exactly one primary anchor")
        bugs.append(
            {
                "code": entry["gt_code"],
                "ticket": entry["ticket"],
                "level": entry["level"],
                "title": entry["participant_title"],
                "severity": entry["severity"],
                "category": entry["category"],
                "points": entry["points"],
                "root_cause_group": entry["root_cause_group"],
                "explanation": entry["explanation"],
                "aliases": entry["aliases"],
                "locations": locations,
                "hidden_tests": entry["hidden_tests"],
            }
        )
    manifest_out = {
        "version": 1,
        "challenge": "papyrus",
        "source": "generated by scripts/build_papyrus_challenge.py; do not edit by hand",
        "bugs": bugs,
    }
    ORGANIZER.mkdir(parents=True, exist_ok=True)
    (ORGANIZER / "gt-manifest.json").write_text(json.dumps(manifest_out, indent=2) + "\n", encoding="utf-8")
    return manifest_out


def generate_hidden_tests(manifest: dict) -> None:
    hidden_dir = ORGANIZER / "hidden_tests"
    if hidden_dir.exists():
        shutil.rmtree(hidden_dir)
    hidden_dir.mkdir(parents=True)
    for entry in manifest["entries"]:
        for hidden_id in entry["hidden_tests"]:
            if entry.get("tc"):
                body = entry["tc"]["body"].strip("\n")
                title = entry["tc"]["title"]
            else:
                body = entry["hidden_test_body"].strip("\n")
                title = entry["participant_title"]
            (hidden_dir / f"{hidden_id}.test.js").write_text(
                HIDDEN_TEMPLATE.format(
                    ticket=entry["ticket"],
                    gt_code=entry["gt_code"],
                    hidden_id=hidden_id,
                    title=title,
                    body=body,
                ),
                encoding="utf-8",
            )


def generate_answer_key(manifest: dict, flags: list[dict]) -> None:
    lines = [
        "# Organizer answer key (generated)",
        "",
        "RESTRICTED: organizer material. Generated from organizer/injection-manifest.json",
        "by scripts/build_papyrus_challenge.py; never ships to participants. Regenerate",
        "instead of editing by hand.",
        "",
        "## Seed accounts",
        "",
        "The deterministic campus seed (db/seeds/campus.js) creates mira@campus.edu",
        "(admin), joel@campus.edu and priya@campus.edu. Shared seed password:",
        "`Papyrus-Campus-1`. Hidden tests register their own accounts and never rely",
        "on these logins.",
        "",
        "## Award units",
    ]
    for entry in manifest["entries"]:
        lines += [
            "",
            f"### {entry['ticket']} / {entry['gt_code']} - Level {entry['level']}, {entry['points']} points, {entry['category']}",
            "",
            f"Participant title: {entry['participant_title']}",
            f"Primary file: {entry['primary_file']}",
            "",
            f"Root cause: {entry['explanation']}",
            "",
            f"Reproduction: {entry['reproduction']}",
            f"Correct fix: {entry['fix_guidance']}",
        ]
        if entry.get("decoy"):
            lines += [
                f"Decoy patch: {entry['decoy']['patch']}",
                f"Why the decoy is wrong: {entry['decoy']['why_wrong']}",
            ]
        if entry.get("tc"):
            lines.append(f"Level 1 check: {entry['tc']['id']} ({entry['tc']['title']})")
        lines.append("Hidden tests: " + ", ".join(entry["hidden_tests"]))
    lines += ["", "## Side quest flags (plaintext, organizer only)", ""]
    for flag in flags:
        lines.append(f"- {flag['flag_key']}: {flag['plaintext']} ({flag['points']} points) - {flag['position_label']}")
    (ORGANIZER / "answer-key.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def flag_code_hash(code: str) -> str:
    """Mirrors app.security.flag_code_hash exactly: HMAC-SHA256 of the stripped
    code under settings.jwt_secret (env override JWT_SECRET honored, same
    pydantic-settings default). Keep the two in sync."""
    secret = os.environ.get("JWT_SECRET", "dev-only-insecure-secret-replace-me")
    return hmac.new(secret.encode(), code.strip().encode(), hashlib.sha256).hexdigest()


def build_sidequests() -> list[dict]:
    """Deterministic side quest pack (spec 6.3). Plaintext stays in the answer key."""
    flags = [
        {
            "flag_key": "SQ-1",
            "plaintext": "FLAG{layer_by_layer_b64_5e21}",
            "points": 30,
            "max_awards": 99,
            "position_label": "field notes",
        },
        {
            "flag_key": "SQ-2",
            "plaintext": "FLAG{gateway_7f3a9c21}",
            "points": 30,
            "max_awards": 99,
            "position_label": "gateway log",
        },
        {
            "flag_key": "SQ-3",
            "plaintext": "FLAG{ghost_commit_9a1c}",
            "points": 30,
            "max_awards": 99,
            "position_label": "ghost bundle",
        },
        {
            "flag_key": "SQ-4",
            "plaintext": "FLAG{vigenere_fallback_2b7d}",
            "points": 40,
            "max_awards": 99,
            "position_label": "notice board",
        },
        {
            "flag_key": "SQ-5",
            "plaintext": "FLAG{lsb_pixels_e64f}",
            "points": 40,
            "max_awards": 99,
            "position_label": "campus photo",
        },
    ]
    pack = ORGANIZER / "sidequest-pack"
    if pack.exists():
        shutil.rmtree(pack)
    pack.mkdir(parents=True)

    # SQ-1: three chained base64 fragments.
    inner = base64.b64encode(flags[0]["plaintext"].encode()).decode()
    outer = base64.b64encode(("Take fragment B and base64-decode it twice.\n" + inner).encode()).decode()
    b = base64.b64encode(inner.encode()).decode()
    c = base64.b64encode(
        b"Flag format is FLAG{...}. Fragment A tells you the order; you are two decodes away."
    ).decode()
    (pack / "field-notes.txt").write_text(
        f"FIELD NOTES (found in the campus library margin)\n\nA: {outer}\n\nB: {b}\n\nC: {c}\n",
        encoding="utf-8",
    )

    # SQ-2: gateway log, 400 lines, token split across two headers.
    log = []
    for i in range(400):
        line = (
            f"2026-12-06T09:{i // 60:02d}:{i % 60:02d}Z gw-1 http incoming req_id=g{i:04d} "
            f"method={'GET' if i % 3 else 'POST'} path=/api/notes status=200 rt_ms={20 + i % 40}"
        )
        log.append(line)
        if i == 87:
            log.append('2026-12-06T09:01:27Z gw-1 hdr retry-x: session=j83k x-flag-part: "FLAG{gateway_"')
        if i == 231:
            log.append('2026-12-06T09:03:51Z gw-1 hdr probe: upstream=notes x-flag-part: "7f3a9c21}"')
    (pack / "gateway.log").write_text("\n".join(log) + "\n", encoding="utf-8")

    # SQ-3: git bundle with a reverted commit (built in a temp repo).
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "ghost"
        repo.mkdir()

        def git(*args: str) -> None:
            run(["git", *args], cwd=repo)

        git("init", "-q")
        git(
            "-c",
            "user.email=ghost@campus.edu",
            "-c",
            "user.name=Ghost",
            "commit",
            "--allow-empty",
            "-q",
            "-m",
            "campus archive init",
        )
        (repo / "notice.txt").write_text(flags[2]["plaintext"] + "\n", encoding="utf-8")
        git("add", "-A")
        git("-c", "user.email=ghost@campus.edu", "-c", "user.name=Ghost", "commit", "-q", "-m", "Add notice")
        (repo / "notice.txt").write_text("The notice was retired.\n", encoding="utf-8")
        git("add", "-A")
        git("-c", "user.email=ghost@campus.edu", "-c", "user.name=Ghost", "commit", "-q", "-m", 'Revert "Add notice"')
        git("bundle", "create", str(pack / "ghost.bundle"), "--all")
    (pack / "README.md").write_text(
        "# Side quest pack (Fall Back)\n\n"
        "Optional, offline, unrelated to the challenge repository. Submit decoded\n"
        "phrases through the flag-code endpoint. Wrong and duplicate codes are\n"
        "recorded. Bonus is capped per team.\n",
        encoding="utf-8",
    )

    # SQ-4: Vigenere with a known crib.
    key = "FALLBACK"
    plaintext = "the library closes at nine tonight. the access phrase is FLAG{vigenere_fallback_2b7d}"

    def vigenere(text: str, key: str) -> str:
        out = []
        ki = 0
        for ch in text:
            if ch.isalpha():
                base = ord("a") if ch.islower() else ord("A")
                shift = ord(key[ki % len(key)].lower()) - ord("a")
                out.append(chr((ord(ch) - base + shift) % 26 + base))
                ki += 1
            else:
                out.append(ch)
        return "".join(out)

    (pack / "notice.txt").write_text(
        "NOTICE (Vigenere, key recovered from the crib 'the library closes'):\n\n" + vigenere(plaintext, key) + "\n",
        encoding="utf-8",
    )

    # SQ-5: PNG with the flag in the least significant bits + offline decoder.
    from PIL import Image

    flag = flags[4]["plaintext"]
    payload = flag.encode()
    img = Image.new("RGB", (64, 64), (36, 64, 96))
    pixels = img.load()
    bits = "".join(f"{byte:08b}" for byte in payload) + "0" * 8
    idx = 0
    for y in range(64):
        for x in range(64):
            if idx >= len(bits):
                break
            r, g, b = pixels[x, y]
            pixels[x, y] = ((r & 0xFE) | int(bits[idx]), g, b)
            idx += 1
    img.save(pack / "campus.png")
    (pack / "decode_lsb.py").write_text(
        '"""Offline helper: read the length-prefixed LSB payload from campus.png."""\n'
        "from PIL import Image\n"
        'img = Image.open("campus.png")\n'
        "bits = []\n"
        "for y in range(img.height):\n"
        "    for x in range(img.width):\n"
        "        bits.append(img.getpixel((x, y))[0] & 1)\n"
        "        if len(bits) >= 8 * (1 + 32):  # length byte + longest plausible payload\n"
        "            break\n"
        "    if len(bits) >= 8 * 33:\n"
        "        break\n"
        "def to_bytes(bitlist, n):\n"
        "    out = bytearray()\n"
        "    for i in range(n):\n"
        "        byte = 0\n"
        "        for bit in bitlist[i * 8:(i + 1) * 8]:\n"
        "            byte = (byte << 1) | bit\n"
        "        out.append(byte)\n"
        "    return bytes(out)\n"
        "length = to_bytes(bits, 1)[0]\n"
        "print(to_bytes(bits[8:], length).decode(errors='replace'))\n",
        encoding="utf-8",
    )
    return flags


def write_flag_manifest(flags: list[dict]) -> None:
    data = [
        {
            "flag_key": f["flag_key"],
            "code_hash": flag_code_hash(f["plaintext"]),
            "points": f["points"],
            "max_awards": f["max_awards"],
            "position_label": f["position_label"],
        }
        for f in flags
    ]
    (ORGANIZER / "sidequest-flags.json").write_text(
        json.dumps(
            {"version": 1, "note": "HMAC hashes only; plaintext lives in answer-key.md", "flags": data}, indent=2
        )
        + "\n",
        encoding="utf-8",
    )


def npm_test(tree: Path) -> subprocess.CompletedProcess:
    return run(["npm", "test"], cwd=tree, check=False)


def run_hidden(hidden_id: str, tree: Path) -> subprocess.CompletedProcess:
    env = {"PATH": "/usr/bin:/bin:/usr/local/bin", "APP_ROOT": str(tree.resolve()), "HOME": str(Path.home())}
    return run(
        ["node", "--test", str((ORGANIZER / "hidden_tests" / f"{hidden_id}.test.js").resolve())],
        cwd=REPO,
        env=env,
        check=False,
    )


def run_gates(manifest: dict) -> None:
    print("gate: reference npm test")
    proc = npm_test(REFERENCE)
    if proc.returncode != 0:
        fail(f"reference suite must be green before injection:\n{proc.stdout[-3000:]}")

    print("gate: injected npm test (shipped unit suite must be green)")
    proc = npm_test(OUTPUT)
    if proc.returncode != 0:
        fail(f"injected shipped suite must be green (the suite blesses shipped behaviour):\n{proc.stdout[-3000:]}")

    print("gate: hidden tests fail on injected, pass on reference")
    failures = []
    for entry in manifest["entries"]:
        for hidden_id in entry["hidden_tests"]:
            injected = run_hidden(hidden_id, OUTPUT)
            reference = run_hidden(hidden_id, REFERENCE)
            if injected.returncode == 0:
                failures.append(f"{hidden_id}: expected FAIL on injected build, passed")
            if reference.returncode != 0:
                failures.append(f"{hidden_id}: expected PASS on reference build, failed:\n{reference.stdout[-800:]}")
    if failures:
        fail("hidden-test gate:\n" + "\n".join(failures))

    print("gate: injected test:all fails only at the strict search integration test")
    proc = run(["npm", "run", "test:all"], cwd=OUTPUT, check=False)
    failing = [
        line.strip()[2:].split(" (")[0].strip()
        for line in proc.stdout.splitlines()
        if line.startswith("\u2716 ") and not line.startswith("\u2716 failing tests")
    ]
    strict = "search by prefix returns seeded rows"
    unexpected = [name for name in failing if name != strict]
    if proc.returncode == 0 or unexpected or strict not in failing:
        fail(f"test:all must fail exactly at the strict search integration test; got {failing}")


def diff_summary(manifest: dict, files: list[str]) -> None:
    print("\n=== diff summary (two-reviewer audit) ===")
    for entry in manifest["entries"]:
        touched = sorted({p["file"] for p in entry["patches"] if p["find"] != p["replace"]})
        print(f"{entry['ticket']} ({entry['gt_code']}, L{entry['level']}, {entry['points']}pt): {', '.join(touched)}")
    total_lines = sum(
        len(p.read_text(errors="replace").splitlines())
        for p in OUTPUT.rglob("*")
        if p.is_file() and "node_modules" not in p.parts
    )
    print(f"\nparticipant tree: {len(files)} files, ~{total_lines} lines")
    print("organizer artifacts: gt-manifest.json, answer-key.md, hidden_tests/, sidequest-flags.json, sidequest-pack/")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-tests", action="store_true", help="skip npm and hidden-test gates")
    parser.add_argument("--sidequests-only", action="store_true", help="only rebuild the side quest pack")
    args = parser.parse_args()

    if args.sidequests_only:
        flags = build_sidequests()
        write_flag_manifest(flags)
        generate_answer_key(json.loads(MANIFEST_PATH.read_text()), flags)
        print("side quest pack rebuilt")
        return

    if not REFERENCE.exists() or not MANIFEST_PATH.exists():
        fail("papyrus-reference/ and organizer/injection-manifest.json must exist")

    manifest = json.loads(MANIFEST_PATH.read_text())
    copy_tree()
    apply_patches(manifest)
    generate_level1_files(manifest)
    leakage_lint()
    files = participant_files()
    resolve_anchors(manifest)
    flags = build_sidequests()
    write_flag_manifest(flags)
    generate_hidden_tests(manifest)
    generate_answer_key(manifest, flags)

    if not args.skip_tests:
        run_gates(manifest)

    diff_summary(manifest, files)
    print("\nbuild complete: challenge-app/ regenerated deterministically")


if __name__ == "__main__":
    main()
