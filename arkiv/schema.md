# Arkiv schema

All entities are on the Rabdi testnet. The gateway wallet creates and owns them, and the gateway and status page ignore anything else. Checking only the owner isn't enough, because anyone can transfer an entity to our wallet, so both `$creator` and `$owner` must match.

| Entity | Fields | Filtered on | Who can edit | Expires |
|---|---|---|---|---|
| `proofbolt.grant` | `lockerId`, `revoked`, `codeHash`, optional `label` | Read by entity key. The owner's page lists them by `lockerId`, soonest to expire first | Gateway wallet | Set per grant. An expired grant can't open the door |
| `proofbolt.locker` | `lockerId`, `lockReachable` | `lockerId` | Gateway wallet | 60 s, extended every 20 s while the gateway runs. If the gateway dies, the status page shows it as offline |
| `proofbolt.attempt` | `lockerId`, `attemptId`, `outcome`, `reason`, `requestId`, `at` | `lockerId`, sorted by `at` | Gateway wallet | 30 days |
| `proofbolt.decision` | `lockerId`, `attemptId`, `storageRoot`, `anchorTx`, `at` | `lockerId`, sorted by `at` | Gateway wallet | 30 days |

`requestId` is the 0G request behind that decision. A `proofbolt.decision` points to the full record on 0G Storage and its anchor on 0G Chain, and the status page joins the two on `attemptId`.

## Kept off Arkiv

- Access codes. The code exists only in the link given to a person, and Arkiv holds just its SHA-256 hash. The code is 128 random bits, so the hash can't be guessed back.
- Photos and the lock's signing key.
- Full decision records, which go on 0G Storage. Arkiv only holds the pointer.
