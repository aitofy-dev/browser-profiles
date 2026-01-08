# 🚀 rebrowser-patches Integration Guide

> **Goal**: Bypass 99%+ anti-bot detection using rebrowser-patches
> **Time**: 1-2 ngày
> **Difficulty**: Medium

---

## 📋 Tổng quan

**rebrowser-patches** cung cấp:
1. **rebrowser-puppeteer** - Drop-in replacement cho puppeteer
2. **rebrowser-playwright** - Drop-in replacement cho playwright  
3. **Patches** để fix CDP leaks

---

## 🛠️ Các bước Integrate

### Step 1: Cài đặt rebrowser-puppeteer (5 phút)

```bash
cd packages/browser-profiles

# Install rebrowser-puppeteer (thay thế puppeteer-core)
npm install rebrowser-puppeteer-core

# Hoặc nếu cần full puppeteer
npm install rebrowser-puppeteer
```

### Step 2: Update puppeteer integration (30 phút)

Sửa file `src/integrations/puppeteer.ts`:

```typescript
// BEFORE
import puppeteer from 'puppeteer-core';

// AFTER  
import puppeteer from 'rebrowser-puppeteer-core';
```

### Step 3: Test với BrowserScan (10 phút)

```typescript
import { quickLaunch } from './src/integrations/puppeteer';

const { page } = await quickLaunch({ headless: false });
await page.goto('https://browserscan.net');
// Bot Control should be 0%!
```

---

## 📁 Files cần sửa

### 1. package.json

```diff
"dependencies": {
-   "puppeteer-core": "^24.8.0"
+   "rebrowser-puppeteer-core": "^24.8.0"
}

"peerDependencies": {
-   "puppeteer-core": ">=19.0.0"
+   "rebrowser-puppeteer-core": ">=19.0.0"
}
```

### 2. src/integrations/puppeteer.ts

```diff
- import type { Browser, Page } from 'puppeteer-core';
+ import type { Browser, Page } from 'rebrowser-puppeteer-core';

// In connect function:
- const puppeteer = require('puppeteer-core');
+ const puppeteer = require('rebrowser-puppeteer-core');
```

### 3. tsup.config.ts

```diff
external: [
-   'puppeteer-core',
+   'rebrowser-puppeteer-core',
    'playwright'
]
```

---

## ⚙️ rebrowser-patches Options

rebrowser-puppeteer có các options đặc biệt:

```typescript
const browser = await puppeteer.launch({
  // Normal puppeteer options
  headless: false,
  
  // rebrowser-specific options
  __rebrowserPatches: {
    // Fix Runtime.enable leak
    patchRuntimeEnable: true,
    
    // Fix Page.addScriptToEvaluateOnNewDocument leak
    patchPageEvaluate: true,
    
    // Fix Target.setAutoAttach leak
    patchAutoAttach: true,
  }
});
```

---

## 🧪 Testing Checklist

| Test | Expected Result |
|------|-----------------|
| `navigator.webdriver` | `false` |
| BrowserScan Bot Control | 0% |
| CDP detection | Not detected |
| Runtime.enable leak | Fixed |
| Cloudflare challenge | Pass |

---

## 🔧 Full Integration Steps

### Day 1: Setup & Basic Integration

```bash
# 1. Create new branch
git checkout -b feature/rebrowser-integration

# 2. Install rebrowser
npm install rebrowser-puppeteer-core

# 3. Update imports in puppeteer.ts
# 4. Build and test
npm run build
npx tsx test-fingerprint.ts
```

### Day 2: Testing & Finalization

```bash
# 5. Test with BrowserScan
# 6. Test with bot-detector
npx rebrowser-bot-detector

# 7. Update documentation
# 8. Merge PR
```

---

## 📦 Alternative: Use Both

Có thể hỗ trợ cả hai:

```typescript
// src/integrations/puppeteer.ts
let puppeteer: any;

try {
  // Try rebrowser first (better detection bypass)
  puppeteer = require('rebrowser-puppeteer-core');
  console.log('[browser-profiles] Using rebrowser-puppeteer');
} catch {
  // Fallback to regular puppeteer
  puppeteer = require('puppeteer-core');
  console.log('[browser-profiles] Using puppeteer-core');
}
```

```json
// package.json
"peerDependencies": {
  "puppeteer-core": ">=19.0.0",
  "rebrowser-puppeteer-core": ">=19.0.0"
},
"peerDependenciesMeta": {
  "puppeteer-core": { "optional": true },
  "rebrowser-puppeteer-core": { "optional": true }
}
```

---

## 🎯 Expected Results

| Metric | Before | After |
|--------|--------|-------|
| BrowserScan Bot Control | -5% | 0% |
| Cloudflare bypass | ~50% | ~95% |
| DataDome bypass | ~30% | ~80% |
| Detection rate overall | 95% | 99%+ |

---

## ⚠️ Lưu ý

1. **Version matching**: rebrowser version phải match với puppeteer version
2. **Breaking changes**: Some puppeteer-core methods may differ
3. **Community support**: rebrowser ít popular hơn puppeteer

---

## 🔗 Resources

- [rebrowser/rebrowser-patches](https://github.com/rebrowser/rebrowser-patches)
- [rebrowser/rebrowser-puppeteer](https://github.com/rebrowser/rebrowser-puppeteer)
- [rebrowser/bot-detector](https://github.com/nicbarker/rebrowser-bot-detector)
- [rebrowser.net](https://rebrowser.net)

---

*Ready to implement? Let's do it!*
