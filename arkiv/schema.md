# Arkiv schema

All entities are on the Rabdi testnet. The gateway wallet creates and owns them, and the gateway and status page ignore anything else. Checking only the owner isn't enough, because anyone can transfer an entity to our wallet, so both `$creator` and `$owner` must match.

| Entity | Fields | Filtered on | Who can edit | Expires |
|---|---|---|---|---|
| `proofbolt.grant` | `lockerId`, `revoked`, `enrolled` | Read by entity key | Gateway wallet | Set per grant. An expired grant can't open the door |
| `proofbolt.locker` | `lockerId`, `lockReachable` | `lockerId` | Gateway wallet | 60 s, extended every 20 s while the gateway runs. If the gateway dies, the status page shows it as offline |
| `proofbolt.attempt` | `lockerId`, `outcome`, `reason`, `requestId`, `at` | `lockerId`, sorted by `at` | Gateway wallet | 7 days |

`requestId` is the 0G request behind that decision.

## Kept off Arkiv

- World IDs. The link between a person and a grant is in the gateway's `data/enrollments.json`. Arkiv only holds the `enrolled` flag, so losing that file can't reopen a grant to someone new.
- Photos and the lock's signing key.
