# ZAS Safeguard

Control your ZAS Safeguard browser security and parental controls from anywhere.

## Setup

Before using this skill, connect your ZAS account:
`zas:connect your@email.com yourpassword` — Authenticates with your ZAS Safeguard account

## Commands

### Protection
`zas:focus start [duration]` — Start Focus Mode. Blocks social media, gaming, YouTube, Reddit. Duration: 30m, 1h, 2h, 4h, or until midnight. Default: 1 hour.
`zas:focus stop` — Stop Focus Mode
`zas:focus status` — Check if Focus Mode is active and how long remains
`zas:lock` — Enable Internet Lock. Only essential sites remain accessible.
`zas:unlock` — Disable Internet Lock
`zas:block add [domain]` — Add a domain to your personal blocklist
`zas:block remove [domain]` — Remove a domain from your blocklist

### Scanning
`zas:scan [url]` — Scan a URL for threats, phishing, malware, and adult content. Returns a safety verdict with details.

### Stats & Status
`zas:status` — Show your protection status: active features, subscription plan
`zas:stats` — Show today's stats: sites blocked, ads removed, trackers blocked
`zas:devices` — List your connected devices and their online/offline status
`zas:activity [count]` — Show recent blocked sites. Default: 10. Max: 50.

### Account
`zas:account` — Show your account info: plan, trial status, days remaining
`zas:connect` — Connect or reconnect your ZAS Safeguard account
`zas:disconnect` — Remove your ZAS account from this agent
`zas:help` — Show all available commands

## Notes
- Focus Mode and Internet Lock sync to your extension within 10 seconds
- URL scanning uses AI + threat intelligence databases
- Adult content blocking is always on and cannot be disabled via this skill
- Pro features (Focus Mode, Internet Lock) require an active ZAS Safeguard Pro subscription
- Stats reflect the last 24 hours unless otherwise specified
