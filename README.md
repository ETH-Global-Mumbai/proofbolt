# Locker

A locker that opens only when a live grant on Arkiv, a fresh World ID check, a 0G AI decision and a signed command all pass.

```
Browser ── World ID check, camera photo ──> Gateway (laptop) ── 0G Router (AI decision)
                                               │ ───────────── Arkiv (grants, status) ──> Status page
                                     policy.ts decides
                                               │
                              signed one-time command (HMAC + nonce)
                                               ▼
                                     ESP8266 ── servo lock, display, LEDs
```

The ESP8266 holds no AI and no policy. Without a valid command, a key or a live gateway, the door stays locked.

## Run it with no hardware or credentials

```bash
cd gateway
pnpm install
cp .env.example .env
```

Set `LOCK_KEY_HEX` in `.env` to the output of `openssl rand -hex 32`, then run each of these in its own terminal:

```bash
pnpm mock-lock
```

```bash
pnpm start
```

Open http://localhost:8080. With `DEV_MOCKS=1`, World ID and the AI are fake and the seeded grant is `dev-grant`.

## Use Arkiv

Without `ARKIV_PRIVATE_KEY`, `DEV_MOCKS=1` keeps grants in a local file. To use Arkiv, run this and put the key it prints in `.env`:

```bash
pnpm arkiv wallet
```

Fund the address at https://hub.arkiv.network/faucet, and put a key from https://hub.arkiv.network/access-keys in `ARKIV_ACCESS_KEY`. Set `ARKIV_GATEWAY_ADDRESS` to the wallet's address, then check it works and create a grant:

```bash
pnpm arkiv check
```

```bash
pnpm arkiv grant 10
```

Open the kiosk link it prints. To revoke a grant, run `pnpm arkiv revoke <grant>`. The public status page reads only Arkiv, so it keeps working when the gateway is down:

```bash
pnpm status
```

Open http://localhost:8090. See [arkiv/schema.md](arkiv/schema.md) for what is stored.

## Publish decisions to 0G

Each decision is uploaded in full to 0G Storage, anchored by the `DecisionAnchor` contract on 0G Chain, then linked from Arkiv and the status page. This runs in the background and never affects the door. Without `OG_PRIVATE_KEY`, `DEV_MOCKS=1` skips it.

Run this and put the key it prints in `.env`, then fund the address at https://faucet.0g.ai:

```bash
pnpm zerog wallet
```

Check that storage works, then deploy the contract and put its address in `OG_ANCHOR_ADDRESS`:

```bash
pnpm zerog check
```

```bash
pnpm zerog deploy
```

Anyone can rebuild and verify the history from 0G alone, with only `OG_ANCHOR_ADDRESS` set:

```bash
pnpm zerog replay
```

Decisions made with `DEV_MOCKS=1` are fake and get published like any other. Deploy a new contract and delete `data/` before the real demo, so the public record holds only real decisions.

## Test the real 0G AI

Set `OG_API_KEY` in `.env`. To use the real AI with a fake World ID, run:

```bash
DEV_AI=LIVE pnpm start
```

To score the AI on your own photos, put JPEGs in `gateway/photos/`, which git ignores. Name each one `<challenge>__<expected answer>.jpg`, like `show-a-fist__OPEN.jpg`, `show-a-fist__HOLD-wrong-gesture.jpg` or `show-a-fist__ALERT-printed.jpg`. Each photo spends credits:

```bash
pnpm zerog photos photos
```

## Flash the ESP8266

```bash
cd firmware
cp include/secrets.example.h include/secrets.h
```

Edit `secrets.h`, using the same `LOCK_ID` and key as the gateway's `.env`, then flash and watch the serial log:

```bash
pio run -t upload -t monitor
```

Set `LOCK_URL` in `.env` to the IP address the board prints, and remove `DEV_MOCKS` to use the real services.

| Part | Pin |
|---|---|
| Servo signal | GPIO14 (D5), with the servo on a separate 5 V supply and a shared ground |
| Red LED | GPIO12 (D6) |
| Green LED | GPIO13 (D7) |
| I2C display | SDA GPIO4 (D2), SCL GPIO5 (D1). SSD1306 and PCF8574 LCD are detected at boot |

Check `ANGLE_LOCKED` and `ANGLE_OPEN` in `src/main.cpp` against your bolt before fitting the servo.

## Lock API

| Route | Purpose |
|---|---|
| `GET /nonce` | Issues the single outstanding nonce, valid for 15 seconds |
| `POST /cmd` | Form fields `nonce`, `cmd` (`OPEN`, `SHOW`, `SAFE`, `PING`), `arg`, `mac` |
| `GET /status` | Lock state, with no authentication |

`mac` is HMAC-SHA256 of `locker-v1\n<lock id>\n<nonce>\n<cmd>\n<arg>`. Every attempt uses up the nonce, and five bad MACs lock the API for 30 seconds. If no valid command arrives for 8 seconds, the board relocks and shows `SAFE STOP`.

## Tests

```bash
cd gateway && pnpm test && pnpm typecheck
```

```bash
cd firmware && g++ -std=c++17 -Iinclude test/gate_test.cpp -lcrypto -o /tmp/gate_test && /tmp/gate_test
```

## Not built yet

- `WORLD_DEBRIEF.md`, which the World prize requires.
- `arkiv/reach.md`, `arkiv/why-arkiv.md` and `arkiv/how-you-use-arkiv.md`, plus the writer wallet and a sample query in this README, which the Arkiv prize requires.

## Known limits

- The gateway trusts its camera, so injected video could pass the challenge.
- The gateway holds the policy and the signing key, so it is a trusted party.
- If Arkiv can't be read, every unlock is refused. If a status write or 0G upload fails, the door still works and publishing retries.
- The key sits in the board's external flash, so the board must stay inside the locked box.
- Anyone on the network can request a nonce, which can disrupt a command but can't open the lock.
- The randomness of `ESP.random()` has not been measured.
