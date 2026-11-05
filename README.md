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

- Uploading the log to 0G Storage. It is only written to `data/episode.jsonl` for now.
- The on-chain contract, which 0G requires.
- `WORLD_DEBRIEF.md`, which the World prize requires.
- `arkiv/reach.md`, `arkiv/why-arkiv.md` and `arkiv/how-you-use-arkiv.md`, plus the writer wallet and a sample query in this README, which the Arkiv prize requires.

## Known limits

- The gateway trusts its camera, so injected video could pass the challenge.
- The gateway holds the policy and the signing key, so it is a trusted party.
- If Arkiv can't be read, every unlock is refused. If a status write fails, the door still works and the page goes stale.
- The key sits in the board's external flash, so the board must stay inside the locked box.
- Anyone on the network can request a nonce, which can disrupt a command but can't open the lock.
- The randomness of `ESP.random()` has not been measured.
