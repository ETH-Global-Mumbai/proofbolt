// Turns any error into one line that's safe to log. viem puts the RPC URL in its messages, and
// on Arkiv that URL contains the access key.
const ACCESS_KEY = /ark_[a-z]+_[\w-]+/g;

interface ChainedError {
  message?: string;
  shortMessage?: string;
  details?: string;
  cause?: unknown;
}

export function errorText(error: unknown): string {
  let current = error as ChainedError | undefined;
  let text = String(error);
  while (current && typeof current === "object") {
    text = current.details ?? current.shortMessage ?? current.message ?? text;
    current = current.cause as ChainedError | undefined;
  }
  return text.split("\n")[0]!.replace(ACCESS_KEY, "<access key>");
}
