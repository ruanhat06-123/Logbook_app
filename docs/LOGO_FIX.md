# 🔧 Logo Display Fix Guide

## Problem
Logo not showing on main landing page after folder reorganization.

## Solution

### Quick Fix (For Users)

Clear browser cache and reload:

1. **Hard Refresh** (Chrome/Firefox/Edge):
   - Press `Ctrl+Shift+R` (Windows/Linux)
   - Or `Cmd+Shift+R` (Mac)

2. **Clear Service Worker Cache**:
   - Open DevTools (F12)
   - Go to **Application** tab
   - Click **Service Workers**
   - Click **Unregister** next to LogMate
   - Click **Storage** → **Cache Storage**
   - Delete all caches starting with "logmate"

3. **Reload Page**:
   - Close and reopen the app
   - Logo should now display

### What Changed

**Before Reorganization**:
- Logo at: `/logo.svg`
- Referenced as: `src="logo.svg"`

**After Reorganization**:
- Logo at: `/assets/logo.svg`
- Referenced as: `src="assets/logo.svg"`

### Files Updated

✅ `index.html` - Landing page references
✅ `manifest.json` - PWA icon reference
✅ `sw.js` - Service worker asset list (cache version bumped to v5)
✅ `html/offline.html` - Offline page reference
✅ All page HTML files - Logo references

### Path Structure

```
LogMate/
├── assets/
│   └── logo.svg          ← Logo file location
├── index.html            ← Landing page (references assets/logo.svg)
├── html/
│   ├── login.html        ← References ../assets/logo.svg
│   ├── dashboard.html    ← References ../assets/logo.svg
│   └── ... (other pages)
├── css/
├── js/
└── sw.js
```

### Verification

To verify logo paths are correct:

```bash
# Check all logo references
grep -r "logo.svg" .

# Expected output:
# ./assets/logo.svg         (actual file)
# ./index.html:...assets/logo.svg
# ./manifest.json:...assets/logo.svg
# ./sw.js:/assets/logo.svg
# ./html/*.html:../assets/logo.svg
```

### Browser DevTools Check

1. Open DevTools (F12)
2. Go to **Network** tab
3. Refresh page
4. Look for `logo.svg` request
5. Should show: `GET /assets/logo.svg` → Status 200

If status is 404:
- File path incorrect
- Service worker serving wrong path
- Static server not configured correctly

### Server Configuration

If using a static file server, ensure it serves files from the project root:

```bash
# Example with Python
python -m http.server 8000

# Example with Node/Express
app.use(express.static('./'));
```

Both above serve `/assets/logo.svg` from the root directory.

### Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| **Logo 404** | Wrong path in file | Verify file at `/assets/logo.svg` |
| **Logo blank/broken** | Old service worker | Clear cache, hard refresh (Ctrl+Shift+R) |
| **Logo shows in some pages only** | Inconsistent path references | Check relative paths (../) |
| **Logo not in PWA** | manifest.json wrong | Updated to `/assets/logo.svg` |

### Debugging Steps

1. **Check file exists**:
   ```bash
   ls -la assets/logo.svg
   ```
   Should show file with size ~256 bytes

2. **Check HTML references**:
   ```bash
   grep "logo.svg" index.html
   ```
   Should show: `src="assets/logo.svg"`

3. **Check Service Worker**:
   - DevTools → Application → Service Workers
   - Check "logmate-shell-v5" is registered
   - Version incremented clears old cache

4. **Check Network Requests**:
   - DevTools → Network
   - Look for logo.svg requests
   - Should be GET /assets/logo.svg 200 OK

### After Fix

Once logo is displaying:

- ✅ Landing page shows logo
- ✅ All app pages show logo
- ✅ PWA manifest has correct icon path
- ✅ Service worker caches logo file
- ✅ Offline page has logo

### Prevention for Future

When moving/renaming assets:

1. Update all references in HTML files
2. Update manifest.json
3. Update service worker APP_SHELL list
4. Increment cache version (v5 → v6)
5. Hard refresh in browser
6. Test in DevTools offline mode

---

## Summary

Logo display should now work correctly:

- ✅ File location: `/assets/logo.svg`
- ✅ All references updated to new path
- ✅ Service worker cache version bumped to v5
- ✅ Browser cache will clear automatically

**Try the Quick Fix steps above if logo still doesn't show!**

