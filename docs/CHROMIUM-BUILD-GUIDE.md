# 🔧 Modified Chromium Build Guide

> **Goal**: Build a custom Chromium that is undetectable by anti-bot services
> **Estimated Time**: 4-8 weeks
> **Difficulty**: Advanced

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Building Chromium](#building-chromium)
4. [Patches to Apply](#patches-to-apply)
5. [Testing](#testing)
6. [Distribution](#distribution)
7. [Resources](#resources)

---

## 📚 Prerequisites

### Required Skills

| Skill | Level | Why Needed |
|-------|-------|------------|
| **C++** | Intermediate | Chromium is written in C++ |
| **Python** | Basic | Build scripts, testing |
| **Git** | Intermediate | Manage 30GB+ repo |
| **Linux Admin** | Intermediate | Build environment |
| **Build Systems** (gn, ninja) | Basic | Chromium build system |
| **Browser Internals** | Basic | Understanding V8, Blink, CDP |

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **RAM** | 16GB | 32GB+ |
| **CPU** | 4 cores | 8+ cores (16 threads) |
| **Storage** | 100GB SSD | 200GB+ NVMe |
| **Network** | 50Mbps | 100Mbps+ (for initial fetch) |

### Build Time Estimates

| Hardware | Debug Build | Release Build |
|----------|-------------|---------------|
| 4 cores, 16GB RAM | 16-24 hours | 8-12 hours |
| 8 cores, 32GB RAM | 6-8 hours | 3-4 hours |
| 16 cores, 64GB RAM | 2-3 hours | 1-2 hours |
| Cloud (96 cores) | 30-45 min | 15-30 min |

---

## 🖥️ Environment Setup

### Option 1: Linux (Recommended)

```bash
# Ubuntu 22.04 LTS recommended
sudo apt update
sudo apt install -y \
    build-essential \
    git \
    python3 \
    python3-pip \
    lsb-release \
    sudo \
    curl \
    wget

# Install depot_tools
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH="$PATH:$HOME/depot_tools"
echo 'export PATH="$PATH:$HOME/depot_tools"' >> ~/.bashrc

# Verify
gclient --version
```

### Option 2: Docker (Cleaner)

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    build-essential git python3 curl wget lsb-release sudo

RUN git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git /opt/depot_tools
ENV PATH="/opt/depot_tools:$PATH"

WORKDIR /chromium
```

### Option 3: Cloud Build (Fastest)

Use GitHub Actions with a powerful runner:

```yaml
name: Build Chromium
on: workflow_dispatch

jobs:
  build:
    runs-on: ubuntu-latest-16-core
    steps:
      - name: Setup depot_tools
        run: |
          git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
          echo "$PWD/depot_tools" >> $GITHUB_PATH
```

---

## 🏗️ Building Chromium

### Step 1: Fetch Source (~30GB, 1-4 hours)

```bash
mkdir ~/chromium && cd ~/chromium

# Create .gclient config
cat > .gclient << 'EOF'
solutions = [
  {
    "name": "src",
    "url": "https://chromium.googlesource.com/chromium/src.git",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {},
  },
]
EOF

# Fetch source (this takes a while!)
gclient sync --no-history --shallow

# Install build dependencies
cd src
./build/install-build-deps.sh
```

### Step 2: Configure Build

```bash
cd ~/chromium/src

# Generate build files
gn gen out/Release --args='
  is_debug = false
  is_official_build = true
  chrome_pgo_phase = 0
  is_component_build = false
  symbol_level = 0
  enable_nacl = false
  blink_symbol_level = 0
  v8_symbol_level = 0
'

# For debug builds (faster but larger)
gn gen out/Debug --args='
  is_debug = true
  is_component_build = true
  symbol_level = 1
'
```

### Step 3: Build

```bash
# Build Chrome (this takes hours!)
autoninja -C out/Release chrome

# Parallel builds (adjust -j based on CPU cores)
ninja -C out/Release chrome -j 8
```

### Step 4: Test Build

```bash
# Run the built Chrome
./out/Release/chrome --no-sandbox
```

---

## 🩹 Patches to Apply

### Patch 1: Remove webdriver Flag

**File**: `third_party/blink/renderer/core/frame/navigator.cc`

```diff
- bool Navigator::webdriver() const {
-   return GetFrame()->GetSettings()->GetWebDriver();
- }
+ bool Navigator::webdriver() const {
+   return false;  // Always return false
+ }
```

### Patch 2: Hide CDP Connection

**File**: `content/browser/devtools/devtools_agent_host_impl.cc`

```diff
// Remove identifiable CDP headers
- void DevToolsAgentHostImpl::SendProtocolResponse(...) {
-   // Original implementation with identifiable headers
- }
+ void DevToolsAgentHostImpl::SendProtocolResponse(...) {
+   // Stripped headers that reveal CDP
+ }
```

### Patch 3: Remove Automation Flags

**File**: `chrome/common/chrome_switches.cc`

```diff
// Remove automation-related switches from being detectable
- const char kEnableAutomation[] = "enable-automation";
+ // Removed: const char kEnableAutomation[] = "enable-automation";
```

### Patch 4: Fix User-Agent

**File**: `content/common/user_agent.cc`

```diff
// Remove "HeadlessChrome" from UA
- if (headless) {
-   return "HeadlessChrome/" + version;
- }
+ // Always return normal Chrome UA
+ return "Chrome/" + version;
```

### Patch 5: Canvas Fingerprint Noise

**File**: `third_party/blink/renderer/modules/canvas/canvas2d/canvas_rendering_context_2d.cc`

```cpp
// Add noise to getImageData
ImageData* CanvasRenderingContext2D::getImageData(...) {
  ImageData* data = original_getImageData(...);
  
  // Add consistent noise based on profile seed
  uint32_t seed = GetProfileSeed();
  for (int i = 0; i < data->length(); i += 4) {
    data[i] += (seed % 5) - 2;     // R
    data[i+1] += (seed % 7) - 3;   // G  
    data[i+2] += (seed % 3) - 1;   // B
  }
  
  return data;
}
```

### Patch 6: Audio Fingerprint Noise

**File**: `third_party/blink/renderer/modules/webaudio/audio_context.cc`

```cpp
// Add noise to audio output
void AudioContext::ProcessAudio(...) {
  // Add subtle noise to prevent fingerprinting
  float noise = GetProfileNoise();
  for (sample : samples) {
    sample += noise * 0.0001f;
  }
}
```

---

## 🧪 Testing

### Test 1: Basic Functionality

```bash
./out/Release/chrome --no-sandbox https://google.com
```

### Test 2: Anti-Bot Detection Sites

```bash
# Test against detection sites
./out/Release/chrome --no-sandbox \
  --user-data-dir=/tmp/test-profile \
  https://www.browserscan.net/

# Check scores:
# - Bot Control: Should be 0%
# - Webdriver: Should show "No"
# - CDP: Should not be detected
```

### Test 3: Automation Script

```javascript
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.launch({
  executablePath: '/path/to/out/Release/chrome',
  headless: false,
});

const page = await browser.newPage();
await page.goto('https://browserscan.net');

// Check results
const webdriver = await page.evaluate(() => navigator.webdriver);
console.log('webdriver:', webdriver); // Should be false
```

---

## 📦 Distribution

### Option 1: Binary Distribution

```bash
# Package Chrome for distribution
cd ~/chromium/src/out/Release

# Create archive
tar -czvf chromium-antidetect-$(date +%Y%m%d).tar.gz \
  chrome \
  chrome_sandbox \
  libEGL.so \
  libGLESv2.so \
  resources.pak \
  locales/
```

### Option 2: npm Package

```json
{
  "name": "@aitofy/chromium-antidetect",
  "version": "1.0.0",
  "bin": {
    "chromium": "./chromium"
  },
  "os": ["linux", "darwin", "win32"],
  "cpu": ["x64", "arm64"]
}
```

### Option 3: Auto-Updater

```javascript
// Check for updates
const { app, autoUpdater } = require('electron');

autoUpdater.setFeedURL({
  url: 'https://releases.aitofy.dev/chromium'
});
```

---

## 🔗 Resources

### Official Documentation
- [Chromium Build Instructions](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md)
- [GN Build Configuration](https://gn.googlesource.com/gn/+/master/docs/quick_start.md)
- [Chromium Design Documents](https://www.chromium.org/developers/design-documents/)

### Reference Projects
- [puppeteer-extra-stealth](https://github.com/nicbarker/pptr-fp) - JS-based stealth
- [browser-patches](https://github.com/nicbarker/browser-patches) - Chromium patch examples
- [AntiBrowser/AntiBrowser](https://github.com/nicbarker/AntiBrowser) - Modified browser

### Community
- [AntiBotDev Discord](https://discord.gg/antibot) - Anti-detect community
- [r/webscraping](https://reddit.com/r/webscraping) - Scraping discussions

---

## ⏱️ Timeline

| Week | Goal | Deliverable |
|------|------|-------------|
| 1 | Environment setup | Working build environment |
| 2 | First successful build | Vanilla Chromium binary |
| 3 | Apply basic patches | webdriver, CDP hidden |
| 4 | Apply fingerprint patches | Canvas, audio noise |
| 5 | Testing & fixing | 100% BrowserScan score |
| 6 | Build automation | CI/CD pipeline |
| 7 | Distribution | npm package |
| 8 | Documentation | User guide |

---

## ⚠️ Legal Considerations

1. **Chromium is open source** (BSD license) - modifications are allowed
2. **Do not use for**: fraud, account theft, illegal activities
3. **Respect ToS**: Some sites explicitly prohibit automation
4. **Distribution**: You can distribute your modified version

---

## 🚀 Quick Start Commands

```bash
# 1. Setup
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH="$PATH:$PWD/depot_tools"

# 2. Fetch
mkdir chromium && cd chromium
fetch --no-history chromium

# 3. Apply patches
cd src
git apply patches/*.patch

# 4. Build
gn gen out/Release --args='is_debug=false'
autoninja -C out/Release chrome

# 5. Test
./out/Release/chrome --no-sandbox https://browserscan.net
```

---

*Last updated: 2026-01-08*
