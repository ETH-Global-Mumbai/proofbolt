# Why Arkiv

## What users would lose with Postgres

- **An honest status page when the operator's machine dies.** The page reads Arkiv and has no link to the gateway. With a database on the gateway, the page would die with it. With a hosted database, the gateway would have to write "offline" about itself, and a dead gateway can't. Here the locker's entity simply expires.
- **Expiry that nobody has to run.** A grant stops working at its time without a cleanup job, and the door refuses it.
- **History the operator can't quietly edit.** Attempts are public and tied to the gateway's wallet, so anyone can query them without an account or our permission. Entities can still be changed or deleted by the owner, so the tamper-evident record is the hash chain anchored on 0G Chain, and Arkiv is the readable index that points to it.

## What we kept off Arkiv, and why

| Data | Where it is | Why |
|---|---|---|
| Access codes | Only in the link given to a person. Arkiv holds a hash | A public code would let anyone try the door |
| Photos | Nowhere. Only a hash is kept | They show people's hands and surroundings |
| Lock signing key and wallet keys | `.env`, `secrets.h`, both ignored by git | Secrets |
| Full decision records | 0G Storage | They are the audit log, and 0G's proofs protect them. Arkiv holds only the pointer |
| Every heartbeat to the lock | Nowhere | Sent every 3 s and of no later use. The locker entity holds just the current state |
