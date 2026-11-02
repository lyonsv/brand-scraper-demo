import type { ErrorCode } from "./types";

export class ScanError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ScanError";
  }
}

export const FRIENDLY_ERRORS: Record<ErrorCode, string> = {
  invalid_url: "That doesn't look like a website address. Try something like stripe.com.",
  blocked_url: "That address points to a private or internal network, so we won't scan it.",
  bot_protected: "This site is protected by a bot challenge, so a headless browser can't see it.",
  timeout: "The site took too long to load and analyse. Try again or pick another URL.",
  nav_failed: "We couldn't load that page. Check the address and that the site is up.",
  rate_limited: "You've hit the scan limit for now. This public demo allows a few scans every 10 minutes.",
  busy: "The scanner is busy with other scans right now. Please try again in a minute.",
  internal: "Something went wrong on our side while scanning. Please try again.",
};
