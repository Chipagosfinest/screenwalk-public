export type EntryCtaCandidate = {
  name: string;
  role: "button" | "other";
  type?: string;
  disabled?: boolean;
};

const AUTH_ACTION = /^(sign\s*in|sign\s*up|log\s*in|log\s*on|register|continue with|authenticate)\b/i;
const DESTRUCTIVE_ACTION = /\b(delete|remove|destroy|logout|log out|sign out|unsubscribe|purchase|checkout|pay now|buy now)\b/i;
const PRIMARY_ACTION = /^(find matches|search|get started|start|continue|next|try(?: it| now)?|create|new hunt|see (?:results|matches)|open(?: the)? comparison|submit)\b/i;

export function isAuthAction(name: string): boolean {
  return AUTH_ACTION.test(name.trim());
}

export function isDestructiveAction(name: string): boolean {
  return DESTRUCTIVE_ACTION.test(name.trim());
}

export function pickEntryCta(candidates: EntryCtaCandidate[]): EntryCtaCandidate | undefined {
  return candidates.find((candidate) => (
    !candidate.disabled
    && candidate.role === "button"
    && PRIMARY_ACTION.test(candidate.name.trim())
    && !isAuthAction(candidate.name)
    && !isDestructiveAction(candidate.name)
  ));
}
