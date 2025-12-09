# ZAS Safeguard - Test Scenarios

## Critical Test Cases

### 1. Extension Disabled Attempt
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install extension, login | Extension active, blocking enabled |
| 2 | Go to `chrome://extensions` | Extension visible |
| 3 | Click disable toggle | Tamper event logged to Firestore |
| 4 | Check `admin_logs` | `extension_disabled` event present |
| 5 | Owner mode: extension re-enables | Blocking remains active |

### 2. Internet Disconnected
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install extension, login, sync | Blocklist cached locally |
| 2 | Disconnect WiFi/Ethernet | No internet connection |
| 3 | Visit blocked site (e.g., pornhub.com) | Site BLOCKED using fallback list |
| 4 | Check console logs | "Offline fallback active" message |
| 5 | Reconnect internet | Full blocklist syncs |

### 3. Browser Data Cleared
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install extension, login | Token stored in `chrome.storage.local` |
| 2 | Clear browser data (cookies, cache) | Storage untouched (extension storage separate) |
| 3 | Blocking status | Still active |
| 4 | Clear extension data via settings | Must re-login, fallback blocklist active |

### 4. Incognito Mode Used
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Check extension settings | "Allow in incognito" permission |
| 2 | Open incognito window | Extension active (if permitted) |
| 3 | Visit blocked site | Site BLOCKED |
| 4 | If incognito blocked | User cannot bypass via incognito |

### 5. DNS Manually Changed
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Change system DNS to 8.8.8.8 | DNS changed |
| 2 | Visit blocked site | Site BLOCKED (extension works at browser level) |
| 3 | Extension blocks URLs directly | DNS bypass does not work |

### 6. Device Clock Changed
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start study session (1 hour) | Session active |
| 2 | Change system clock forward 2 hours | Clock manipulated |
| 3 | Check session status | Server timestamp used, session still active |
| 4 | Server-side validation | Prevents clock manipulation bypass |

### 7. DevTools Opened
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open blocked page | Blocked page shown |
| 2 | Press F12 / Cmd+Opt+I | DevTools opens |
| 3 | Check `admin_logs` | `dev_tools_opened` event logged |
| 4 | Console interference detected | Logged as tamper attempt |

---

## Uninstall Protection Tests

### Test A: Uninstall Without Internet
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Disconnect internet | Offline |
| 2 | Try to remove extension via `chrome://extensions` | Extension removal attempted |
| 3 | Owner mode behavior | Removal logged on reconnect |
| 4 | Fallback behavior | If uninstalled, no protection until reinstall |

### Test B: Uninstall with Incognito-Only Browser
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Set browser to always incognito | Persistent incognito |
| 2 | Try to disable/remove extension | Same protection applies |
| 3 | Extension state | Logged as tamper attempt |

---

## Study Mode Tests

### Test: Study Mode Cannot Be Cancelled
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start study session (2 hours) | Session active |
| 2 | Try to access blocked sites | Sites BLOCKED |
| 3 | Try to end session via dashboard | No cancel button |
| 4 | Clear browser data | Session still active (server-side) |
| 5 | Wait for session to expire | Session ends, blocking reverts |

---

## Rate Limiting Tests

### Test: Rapid Write Prevention
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Script 100 rapid blocked URL logs | Attempt 100 writes |
| 2 | Check Firestore | Only ~60 writes allowed (1/sec) |
| 3 | Rate limit response | "Rate limit exceeded" error |
| 4 | Wait 60 seconds | Writes allowed again |

---

## Cache Expiration Tests

### Test: 24-Hour Cache Expiry
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login and sync blocklist | `lastSync` timestamp set |
| 2 | Set system clock +25 hours | Simulate expired cache |
| 3 | Restart extension/browser | Force refresh triggered |
| 4 | Check sync status | New blocklist fetched |
| 5 | If fetch fails | Fallback blocklist remains active |

---

## Security Rule Tests

### Test: Child Cannot Modify Parent Settings
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login as parent | Family mode active |
| 2 | Create child profile | Child created |
| 3 | Simulate child device request | Attempt to modify parent settings |
| 4 | Result | PERMISSION_DENIED error |

### Test: Cannot Write to Core Blocklist
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login as any user | Authenticated |
| 2 | Try: `db.doc('blocklists/core').set({...})` | Attempt write |
| 3 | Result | PERMISSION_DENIED error |
| 4 | Core blocklist | Unchanged |

---

## Backup/Restore Tests

### Test: Export and Import Settings
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Configure blocklist + categories | Settings saved |
| 2 | Click "Export Settings" | JSON file downloaded |
| 3 | Clear all settings | Fresh state |
| 4 | Click "Import Settings" + upload JSON | Settings restored |
| 5 | Verify blocklist | Matches original |

---

## Passing Criteria

- ✅ All "Expected Result" columns match actual behavior
- ✅ No security bypasses possible
- ✅ Fallback behavior works offline
- ✅ All events logged correctly
- ✅ Rate limiting enforced

**Last Tested:** ________________

**Tested By:** ________________
