# 📁 LogMate Project Structure

## Overview

LogMate is now organized with a **clean, flat directory structure** for easy navigation and maintenance.

```
LogMate/
├── 📄 index.html              ← Landing page (PWA entry point)
├── 📄 manifest.json           ← PWA manifest with geolocation permissions
├── 📄 sw.js                   ← Service worker (cache strategy)
│
├── 📂 js/                      ← Application JavaScript
│   ├── app.js                 ← App initialization & utilities
│   ├── landing.js             ← Landing page logic
│   ├── logbook.js             ← Logbook utilities
│   ├── trip.js                ← Trip page logic
│   │
│   ├── core/                  ← Core modules (10 files)
│   │   ├── app.js             ← Global app initialization
│   │   ├── env.js             ← Environment configuration
│   │   ├── supabaseClient.js  ← Supabase client setup
│   │   ├── serviceReminder.js ← Service reminder logic
│   │   │
│   │   ├── gpsTracking.js     ← GPS tracking engine ✨
│   │   ├── localStore.js      ← IndexedDB + localStorage ✨
│   │   ├── distanceCalculator.js ← Haversine + ORS ✨
│   │   ├── offlineSync.js     ← Background sync manager ✨
│   │   ├── offlineIndicator.js ← Offline UX banner ✨
│   │   └── tripUIIntegration.js ← Trip workflow UI ✨
│   │
│   └── pages/                 ← Page-specific modules (12 files)
│       ├── addVehicle.js
│       ├── auth.js
│       ├── dashboard.js
│       ├── help.js
│       ├── logbook.js
│       ├── report.js
│       ├── resetPassword.js
│       ├── settings.js
│       ├── trip.js
│       ├── tripReport.js
│       ├── vehicleList.js
│       └── vehicles.js
│
├── 📂 html/                    ← Application HTML pages (11 files)
│   ├── login.html             ← Authentication
│   ├── dashboard.html         ← Main dashboard
│   ├── trip.html              ← Trip tracking
│   ├── logbook.html           ← Logbook view
│   ├── vehicles.html          ← Vehicle management
│   ├── add-vehicle.html       ← Add new vehicle
│   ├── help.html              ← Help/support
│   ├── report.html            ← Reports
│   ├── trip-report.html       ← Trip reports
│   ├── settings.html          ← App settings
│   ├── reset-password.html    ← Password reset
│   └── offline.html           ← Offline fallback ✨
│
├── 📂 css/                     ← Stylesheets
│   └── style.css              ← Main stylesheet (~28 KB)
│
├── 📂 assets/                  ← Static assets
│   └── logo.svg               ← LogMate logo
│
├── 📂 docs/                    ← Documentation (6 guides)
│   ├── DISTANCE_TRACKING_SETUP.md       ← Complete setup guide
│   ├── GPS_QUICK_REFERENCE.md          ← Quick API reference
│   ├── OFFLINE_SUPPORT.md              ← Offline architecture
│   ├── FULL_OFFLINE_SUPPORT.md         ← Complete offline guide
│   ├── IMPLEMENTATION_COMPLETE.md      ← Implementation summary
│   └── DELIVERY_CHECKLIST.md           ← Delivery verification
│
├── 📂 server/                  ← Backend
│   └── api-server.js          ← Express API server
│
├── .env                        ← Environment variables
├── .gitignore                  ← Git ignore rules
└── .git/                       ← Git history
```

## ✨ New GPS Tracking Features

Files marked with ✨ are new implementations for offline-first GPS distance tracking:

| File | Purpose | Size |
|------|---------|------|
| **js/core/gpsTracking.js** | GPS position tracking with drift filtering | 1.2 KB |
| **js/core/localStore.js** | IndexedDB + localStorage persistence | 2.1 KB |
| **js/core/distanceCalculator.js** | Haversine + OpenRouteService | 3.4 KB |
| **js/core/offlineSync.js** | Network sync orchestrator | 3.2 KB |
| **js/core/offlineIndicator.js** | Offline UX indicator | 2.1 KB |
| **js/core/tripUIIntegration.js** | Trip workflow UI | 8.5 KB |
| **html/offline.html** | Offline fallback page | 3.8 KB |

---

## 🎯 Directory Purpose

### **Root Level**
- `index.html` - Landing page (PWA entry point)
- `manifest.json` - PWA metadata & permissions
- `sw.js` - Service worker with caching strategy

### **js/** - Application Code
- `app.js` - Main app initialization
- `landing.js` - Landing page logic
- `trip.js` - Trip page initialization
- `logbook.js` - Logbook utilities

### **js/core/** - Core Modules
**General modules:**
- `app.js` - Global initialization
- `env.js` - Configuration
- `supabaseClient.js` - Supabase setup
- `serviceReminder.js` - Service reminders

**GPS & Offline modules (NEW):**
- `gpsTracking.js` - GPS tracking engine
- `localStore.js` - Local persistence
- `distanceCalculator.js` - Distance calculation
- `offlineSync.js` - Background sync
- `offlineIndicator.js` - Offline UI
- `tripUIIntegration.js` - Trip workflows

### **js/pages/** - Page Modules
- 12 modules for each app page
- Handle page-specific logic
- Import from `js/core/`

### **html/** - Application Pages
- 11 app pages (all cached for offline use)
- 1 offline fallback page
- Reference css/ and js/ folders

### **css/** - Stylesheets
- `style.css` - Main stylesheet (~28 KB)
- Used by all pages

### **assets/** - Static Resources
- `logo.svg` - App logo
- Images, fonts can be added here

### **docs/** - Documentation
- 6 comprehensive guides
- Setup, API reference, offline architecture
- Testing checklists & deployment info

### **server/** - Backend
- `api-server.js` - Express API server
- Database connections
- OpenRouteService proxy

---

## 📊 File Statistics

| Category | Count | Size |
|----------|-------|------|
| **HTML Files** | 12 | ~100 KB |
| **JavaScript Files** | 29 | ~180 KB |
| **CSS Files** | 1 | ~28 KB |
| **Documentation** | 6 | ~34 KB |
| **Assets** | 1 | <1 KB |
| **Configuration** | 3 | ~5 KB |
| **Total** | 52 | ~350 KB |

---

## 🚀 Key Features by Location

### GPS Tracking
- **Implementation**: `js/core/gpsTracking.js`
- **Storage**: `js/core/localStore.js`
- **Distance**: `js/core/distanceCalculator.js`
- **UI**: `js/core/tripUIIntegration.js`

### Offline Capability
- **Service Worker**: `sw.js` (3-tier caching)
- **Network Detection**: `js/core/offlineIndicator.js`
- **Background Sync**: `js/core/offlineSync.js`
- **Fallback Page**: `html/offline.html`

### PWA Features
- **Manifest**: `manifest.json` (with geolocation permission)
- **Service Worker**: `sw.js` (cache strategy)
- **Meta Tags**: `html/*` (viewport, theme-color)
- **Logo**: `assets/logo.svg` (192x192 minimum)

---

## 📝 Import Paths

### From HTML Pages
```html
<!-- From html/*.html -->
<script src="../js/core/env.js"></script>
<script src="../js/pages/trip.js"></script>
<link rel="stylesheet" href="../css/style.css" />
<img src="../assets/logo.svg" />
```

### From js/ Files
```javascript
// From js/*.js or js/pages/*.js
import { module } from '../core/module.js';
import { getLocalStore } from '../core/localStore.js';
```

### From js/core/ Files
```javascript
// From js/core/*.js
import { supabase } from './supabaseClient.js';
import { startTripTracking } from './gpsTracking.js';
```

---

## 🔧 Adding New Files

### Adding a New Page
1. Create `html/new-page.html` in `html/`
2. Create `js/pages/newPage.js` in `js/pages/`
3. Reference in `html/new-page.html`:
   ```html
   <script type="module" src="../js/pages/newPage.js"></script>
   ```

### Adding a New Core Module
1. Create `js/core/newModule.js`
2. Export functions with proper JSDoc
3. Import in pages that need it:
   ```javascript
   import { func } from '../core/newModule.js';
   ```

### Adding Assets
1. Place in `assets/` folder
2. Reference from HTML:
   ```html
   <img src="../assets/image.png" />
   ```

### Adding Documentation
1. Create `docs/NEW_GUIDE.md`
2. Follow existing doc format
3. Update table of contents in other docs

---

## 📂 Organization Benefits

✅ **Clear Structure** - Each folder has a specific purpose
✅ **Easy Navigation** - Logical file organization
✅ **Modular Code** - Separate concerns (core, pages, UI)
✅ **Maintenance** - Easy to find and update files
✅ **Scalability** - Room to grow without chaos
✅ **Documentation** - Comprehensive guides in docs/
✅ **Cache Strategy** - All files properly organized for SW

---

## 🎓 Next Steps

1. **Review Structure** - Familiarize yourself with layout
2. **Check Documentation** - See `docs/` for detailed guides
3. **Verify Imports** - Ensure paths are correct in your IDE
4. **Test Locally** - Run development server
5. **Deploy** - Push to production

---

## 💡 Tips

- **Find GPS Code**: Look in `js/core/gpsTracking.js` and related files
- **Add Features**: Use `js/pages/` for page-specific logic
- **Offline Testing**: Enable offline in DevTools, everything works
- **Cache Strategy**: Service Worker in `sw.js` controls caching
- **Documentation**: Refer to `docs/` for detailed information

---

*Organization completed: September 6, 2026*
*Structure: Flat with organized subdirectories*
*Status: Production-ready* ✨
