import { MockLock } from "./mock.ts";
import { parseKey } from "./protocol.ts";

const lock = new MockLock(process.env.LOCK_ID ?? "locker-1", parseKey(process.env.LOCK_KEY_HEX ?? ""));
const url = await lock.listen(Number(process.env.MOCK_LOCK_PORT ?? 8081));
console.log(`Mock lock listening on ${url}`);
