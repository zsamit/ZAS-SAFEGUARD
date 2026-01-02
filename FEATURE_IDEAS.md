# ZAS Safeguard - Issues & Feature Roadmap

## 🔴 CRITICAL BUGS TO FIX NOW

### Authentication Issues
- [ ] Extension blocking Firebase Auth calls (just fixed - reload extension)
- [x] Delete account not deleting Auth user (FIXED)
- [x] Login page didn't exist (FIXED - created AuthPage.jsx)

### Subscription System (BROKEN)
- [ ] Promo code redemption doesn't work - need to build it
- [ ] Lifetime users showing as "Free Plan"
- [ ] `getInvoices` Cloud Function returns CORS error
- [ ] Need promo code input on Settings page

### Extension <> Dashboard Sync (BROKEN)
- [ ] Settings not syncing between extension and dashboard
- [ ] Real-time stats from extension not working
- [ ] Ad blocking stats inaccurate

---

## 🟡 FEATURES PARTIALLY WORKING

### Family Controls
- [ ] Multiple child profiles - needs UI
- [ ] Per-child blocking rules - needs UI  
- [ ] Activity reports per child - needs implementation

### Focus Mode
- [ ] Focus mode scheduler - needs UI
- [ ] Study mode works but limited

---

## 🟢 ACTUAL FUTURE ENHANCEMENTS (Nice to Have)

### Onboarding
- [ ] Personal vs Parental mode selection after signup
- [ ] Tutorial walkthrough for new users

### Reports
- [ ] Weekly digest email with activity summary
- [ ] PDF export of activity

### Performance
- [ ] Code splitting for faster load
- [ ] Bundle size optimization (currently 677KB)

### Design
- [ ] Dark mode toggle
- [ ] Mobile responsive improvements

---

## ✅ RECENTLY FIXED

- [x] Extension blocking Firebase Auth (added trusted domains)
- [x] Delete account fixed (prioritizes Auth deletion)
- [x] Login page created (AuthPage.jsx)
- [x] Protected routes added (ProtectedRoute wrapper)
- [x] Auth timeout reduced for faster loading

---

*Last updated: 2026-01-01*
