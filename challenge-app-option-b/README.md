# Marina - Campus Notes (challenge edition, Option B)

Development-only challenge fixture for the Bug Hunt CTF four-level flow.
Same product concept as the Option A fixture (Papyrus): a campus notes app
with notes, comments, sessions and an admin overview. The stack here is
nginx + FastAPI + SQLite (served behind the platform as inert text; the
platform never executes challenge code).

This fixture exists so both repository options can be exercised end to end.
It is NOT the production challenge: the final A/B repositories and ground
truth are organizer deliverables before the event is READY (see
docs/KNOWN_GAPS_AND_OWNER_DECISIONS.md).

Run locally (optional, for organizers only):

    pip install -r requirements.txt
    uvicorn main:app --reload --port 8081

The intentionally planted defects mirror the Option A set one-for-one:
same bug count, severities, categories, point values and root-cause groups.
