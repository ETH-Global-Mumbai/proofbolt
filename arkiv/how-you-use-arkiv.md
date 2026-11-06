# How we use Arkiv

| Feature | Where | What the user sees |
|---|---|---|
| Expiry on grants | `proofbolt.grant`, set when a grant is created | A grant past its time stops opening the door, with `NO_GRANT` on the kiosk and lock |
| Short expiry, extended every 20 s | `proofbolt.locker`, 60 s | If the gateway dies, the status page changes to "Gateway offline" within about a minute, with no one reporting it |
| Editing a field | `revoked` and `enrolled` on a grant | Revoking stops an attempt already in progress, with `GRANT_REVOKED` |
| Filtering on `lockerId`, sorting on `at` | `proofbolt.attempt`, `proofbolt.decision` | The status page's history for this locker, newest first |
| Filtering on creator and owner | Every read | Planted entities never reach the door or the page |

## Who can edit what

The gateway wallet creates and owns every entity, and nothing else can edit them. Anyone can write to Arkiv and transfer an entity to our wallet, so `isTrusted` in [backend.ts](../gateway/src/arkiv/backend.ts) requires both `$creator` and `$owner` to match. The status page uses the same filters.

## Why these lifetimes

- **Grants:** set per grant, because that is how long the access should last.
- **Locker:** 60 s, so a dead gateway shows up quickly, with three chances to extend before it expires.
- **Attempts and decisions:** 30 days, long enough to outlast judging. See [schema.md](schema.md).

## Reads that change what happens

Arkiv is read at two points in every unlock: after World ID, and again after the AI answers, so a revocation during the AI call still counts. If Arkiv can't be read, the door refuses with `ARKIV_UNREACHABLE`. See `submitPhoto` in [service.ts](../gateway/src/service.ts).
