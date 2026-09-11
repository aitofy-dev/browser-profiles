// ============================================================================
// @aitofy/browser-profiles - Fingerprint Protection Scripts
// ============================================================================
// Hardcoded fingerprint protection scripts injected via CDP
// No extensions needed - lighter and works in headless mode
// ============================================================================

/**
 * WebRTC leak protection script
 * Prevents real IP from leaking via WebRTC
 */
export const WEBRTC_PROTECTION_SCRIPT = `
(function() {
  // Disable WebRTC IP leak by overriding RTCPeerConnection
  const originalRTCPeerConnection = window.RTCPeerConnection;
  
  if (!originalRTCPeerConnection) {
    console.log('[browser-profiles] WebRTC not available, skipping protection');
    return;
  }
  
  // Create a wrapper that filters out local IP candidates
  window.RTCPeerConnection = function(configuration, constraints) {
    // Force use of TURN only if possible to hide real IP
    if (configuration && configuration.iceServers) {
      configuration.iceCandidatePoolSize = 0;
    }
    
    const pc = new originalRTCPeerConnection(configuration, constraints);
    
    // Override onicecandidate to filter local IPs
    const originalAddEventListener = pc.addEventListener.bind(pc);
    pc.addEventListener = function(type, listener, options) {
      if (type === 'icecandidate') {
        const wrappedListener = function(event) {
          if (event.candidate && event.candidate.candidate) {
            // Filter out candidates with real IPs (keep relay candidates)
            const candidate = event.candidate.candidate;
            if (candidate.includes('typ host') || candidate.includes('typ srflx')) {
              // Skip host and server reflexive candidates that reveal real IP
              console.log('[browser-profiles] Blocked WebRTC IP leak candidate');
              return;
            }
          }
          listener.call(this, event);
        };
        return originalAddEventListener(type, wrappedListener, options);
      }
      return originalAddEventListener(type, listener, options);
    };
    
    // Also handle the onicecandidate property
    let _onicecandidate = null;
    Object.defineProperty(pc, 'onicecandidate', {
      get: function() { return _onicecandidate; },
      set: function(handler) {
        _onicecandidate = function(event) {
          if (event.candidate && event.candidate.candidate) {
            const candidate = event.candidate.candidate;
            if (candidate.includes('typ host') || candidate.includes('typ srflx')) {
              console.log('[browser-profiles] Blocked WebRTC IP leak candidate');
              return;
            }
          }
          if (handler) handler.call(this, event);
        };
      }
    });
    
    return pc;
  };
  
  // Copy static properties and prototype
  window.RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
  Object.keys(originalRTCPeerConnection).forEach(key => {
    try {
      window.RTCPeerConnection[key] = originalRTCPeerConnection[key];
    } catch(e) {}
  });
  
  console.log('[browser-profiles] WebRTC protection enabled');
})();
`;

/**
 * Canvas fingerprint protection script
 * Adds random noise to canvas data to prevent tracking
 */
export const CANVAS_PROTECTION_SCRIPT = `
(function() {
  // Store original methods
  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  
  // Generate random shift values (consistent per page load)
  const shift = {
    r: Math.floor(Math.random() * 10) - 5,
    g: Math.floor(Math.random() * 10) - 5,
    b: Math.floor(Math.random() * 10) - 5,
    a: Math.floor(Math.random() * 10) - 5
  };
  
  // Noisify canvas data
  function noisify(canvas, context) {
    if (!context || !canvas) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    if (width && height && width * height < 1000000) { // Limit to reasonable size
      try {
        const imageData = originalGetImageData.call(context, 0, 0, width, height);
        
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i + 0] = Math.max(0, Math.min(255, imageData.data[i + 0] + shift.r));
          imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + shift.g));
          imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + shift.b));
          imageData.data[i + 3] = Math.max(0, Math.min(255, imageData.data[i + 3] + shift.a));
        }
        
        context.putImageData(imageData, 0, 0);
      } catch (e) {
        // Ignore cross-origin errors
      }
    }
  }
  
  // Override toBlob
  HTMLCanvasElement.prototype.toBlob = function(...args) {
    noisify(this, this.getContext('2d'));
    return originalToBlob.apply(this, args);
  };
  
  // Override toDataURL
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    noisify(this, this.getContext('2d'));
    return originalToDataURL.apply(this, args);
  };
  
  // Override getImageData
  CanvasRenderingContext2D.prototype.getImageData = function(...args) {
    noisify(this.canvas, this);
    return originalGetImageData.apply(this, args);
  };
  
  console.log('[browser-profiles] Canvas protection enabled');
})();
`;

/**
 * WebGL vendor/renderer pair reported to pages
 */
export interface WebGLSpoofConfig {
  vendor?: string;
  renderer?: string;
}

const DEFAULT_WEBGL: Required<WebGLSpoofConfig> = {
  vendor: 'Google Inc. (Intel)',
  renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
};

/**
 * Build the WebGL protection script for a fixed vendor/renderer.
 * Numeric parameters are derived from a PRNG seeded by the renderer string,
 * so a profile reports the same values on every page load.
 */
export function createWebGLScript(config: WebGLSpoofConfig = {}): string {
  const vendor = config.vendor || DEFAULT_WEBGL.vendor;
  const renderer = config.renderer || DEFAULT_WEBGL.renderer;

  return `
(function() {
  const VENDOR = ${JSON.stringify(vendor)};
  const RENDERER = ${JSON.stringify(renderer)};

  // mulberry32 seeded from the renderer string: stable values per profile
  let seed = 0;
  for (let i = 0; i < RENDERER.length; i++) seed = (seed * 31 + RENDERER.charCodeAt(i)) >>> 0;
  function rand() {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randomItem(arr) {
    return arr[Math.floor(rand() * arr.length)];
  }

  function randomPower(powers) {
    return Math.pow(2, randomItem(powers));
  }

  function randomInt32(powers) {
    const n = randomPower(powers);
    return new Int32Array([n, n]);
  }

  function randomFloat32(powers) {
    const n = randomPower(powers);
    return new Float32Array([1, n]);
  }

  // Values are picked once so repeated getParameter calls agree
  const fixed = {
    3379: randomPower([14, 15]), 34076: randomPower([14, 15]), 34024: randomPower([14, 15]),
    36347: randomPower([12, 13]), 3386: randomInt32([13, 14, 15]),
    33902: randomFloat32([0, 10, 11, 12, 13]), 33901: randomFloat32([0, 10, 11, 12, 13]),
    3413: randomPower([1, 2, 3, 4]), 35660: randomPower([1, 2, 3, 4]), 35661: randomPower([4, 5, 6, 7, 8]),
    34930: randomPower([1, 2, 3, 4]), 36349: randomPower([10, 11, 12, 13]),
    7938: randomItem(["WebGL 1.0", "WebGL 1.0 (OpenGL ES 2.0 Chromium)"]),
    35724: randomItem(["WebGL GLSL ES 1.0", "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)"]),
  };

  // Spoof getParameter
  function spoofGetParameter(proto) {
    const originalGetParameter = proto.getParameter;

    proto.getParameter = function(pname) {
      // Spoof vendor/renderer strings
      if (pname === 37445) return VENDOR; // UNMASKED_VENDOR_WEBGL
      if (pname === 37446) return RENDERER; // UNMASKED_RENDERER_WEBGL
      if (pname === 7936) return "WebKit"; // VENDOR
      if (pname === 7937) return "WebKit WebGL"; // RENDERER
      if (pname === 36348) return 30; // MAX_VERTEX_UNIFORM_VECTORS
      if (Object.prototype.hasOwnProperty.call(fixed, pname)) return fixed[pname];

      return originalGetParameter.call(this, pname);
    };
  }

  // Add noise to buffer data
  function spoofBufferData(proto) {
    const originalBufferData = proto.bufferData;

    proto.bufferData = function(target, data, usage) {
      if (data && data.length) {
        const index = Math.floor(rand() * data.length);
        if (data[index] !== undefined) {
          data[index] = data[index] + 0.1 * rand() * data[index];
        }
      }
      return originalBufferData.call(this, target, data, usage);
    };
  }

  // Apply to WebGL contexts (also present in workers via OffscreenCanvas)
  if (typeof WebGLRenderingContext !== 'undefined') {
    spoofGetParameter(WebGLRenderingContext.prototype);
    spoofBufferData(WebGLRenderingContext.prototype);
  }

  if (typeof WebGL2RenderingContext !== 'undefined') {
    spoofGetParameter(WebGL2RenderingContext.prototype);
    spoofBufferData(WebGL2RenderingContext.prototype);
  }
})();
`;
}

/**
 * WebGL fingerprint protection script with the default Intel/Windows renderer.
 * Prefer createWebGLScript() with the profile's persisted vendor/renderer.
 */
export const WEBGL_PROTECTION_SCRIPT = createWebGLScript();

/**
 * Wrap Worker/SharedWorker so scripts started from the page run the same
 * navigator/WebGL spoof before the real worker script.
 *
 * Limitation: the worker is started from a blob URL, so relative
 * importScripts() inside the worker script and worker `location` differ from
 * the original URL. Module workers and service workers are left untouched.
 */
export function createWorkerSpoofScript(workerPrelude: string): string {
  return `
(function() {
  const PRELUDE = ${JSON.stringify(workerPrelude)};

  function wrapWorker(Original) {
    if (typeof Original !== 'function') return Original;

    const Wrapped = function(url, options) {
      if (options && options.type === 'module') return new Original(url, options);
      let absolute;
      try { absolute = new URL(url, location.href).href; } catch (e) { return new Original(url, options); }
      const source = PRELUDE + '\\nimportScripts(' + JSON.stringify(absolute) + ');';
      const blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      return new Original(blobUrl, options);
    };

    Wrapped.prototype = Original.prototype;
    Object.defineProperty(Wrapped, 'name', { value: Original.name });
    Wrapped.toString = function() { return Original.toString(); };
    return Wrapped;
  }

  if (typeof self.Worker !== 'undefined') self.Worker = wrapWorker(self.Worker);
  if (typeof self.SharedWorker !== 'undefined') self.SharedWorker = wrapWorker(self.SharedWorker);
})();
`;
}

/**
 * AudioContext fingerprint protection script
 * Adds random noise to audio data
 */
export const AUDIO_PROTECTION_SCRIPT = `
(function() {
  let processedBuffer = null;
  
  // Override getChannelData
  if (typeof AudioBuffer !== 'undefined') {
    const originalGetChannelData = AudioBuffer.prototype.getChannelData;
    
    AudioBuffer.prototype.getChannelData = function(channel) {
      const data = originalGetChannelData.call(this, channel);
      
      if (processedBuffer !== data) {
        processedBuffer = data;
        
        // Add tiny noise that doesn't affect audio quality
        for (let i = 0; i < data.length; i += 100) {
          const index = Math.floor(Math.random() * i);
          if (data[index] !== undefined) {
            data[index] = data[index] + Math.random() * 0.0000001;
          }
        }
      }
      
      return data;
    };
  }
  
  // Override createAnalyser to add noise to frequency data
  function spoofCreateAnalyser(AudioContextClass) {
    if (typeof AudioContextClass === 'undefined') return;
    
    const originalCreateAnalyser = AudioContextClass.prototype.createAnalyser;
    
    AudioContextClass.prototype.createAnalyser = function() {
      const analyser = originalCreateAnalyser.call(this);
      
      const originalGetFloatFrequencyData = analyser.getFloatFrequencyData.bind(analyser);
      
      analyser.getFloatFrequencyData = function(array) {
        originalGetFloatFrequencyData(array);
        
        for (let i = 0; i < array.length; i += 100) {
          const index = Math.floor(Math.random() * i);
          if (array[index] !== undefined) {
            array[index] = array[index] + Math.random() * 0.1;
          }
        }
      };
      
      return analyser;
    };
  }
  
  spoofCreateAnalyser(window.AudioContext);
  spoofCreateAnalyser(window.OfflineAudioContext);
  
  console.log('[browser-profiles] Audio protection enabled');
})();
`;

/**
 * Navigator/Browser info spoofing script
 * Overrides navigator properties to match profile config
 */
export function createNavigatorScript(config: {
  userAgent?: string;
  language?: string;
  platform?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  vendor?: string;
}): string {
  return `
(function() {
  const spoofedProps = ${JSON.stringify(config)};
  const navigatorProto = Object.getPrototypeOf(navigator);
  
  // Helper to replace getter with a new value
  function replaceGetter(propName, newValue) {
    try {
      Object.defineProperty(navigatorProto, propName, {
        get: () => newValue,
        configurable: true
      });
    } catch(e) {
      // Fallback: try on navigator directly
      try {
        Object.defineProperty(navigator, propName, {
          value: newValue,
          configurable: true,
          writable: false
        });
      } catch(e2) {}
    }
  }
  
  if (spoofedProps.language) {
    replaceGetter('language', spoofedProps.language);
    replaceGetter('languages', [spoofedProps.language, spoofedProps.language.split('-')[0]]);
  }
  
  if (spoofedProps.platform) {
    replaceGetter('platform', spoofedProps.platform);
  }
  
  if (spoofedProps.hardwareConcurrency) {
    replaceGetter('hardwareConcurrency', spoofedProps.hardwareConcurrency);
  }
  
  if (spoofedProps.deviceMemory) {
    replaceGetter('deviceMemory', spoofedProps.deviceMemory);
  }
  
  if (spoofedProps.vendor) {
    replaceGetter('vendor', spoofedProps.vendor);
  }
  
  console.log('[browser-profiles] Navigator spoofing enabled:', spoofedProps);
})();
`;
}

/**
 * Get all fingerprint protection scripts combined
 */
export function getAllProtectionScripts(options?: {
  webrtc?: boolean;
  canvas?: boolean;
  /** true = default renderer, or a fixed vendor/renderer pair */
  webgl?: boolean | WebGLSpoofConfig;
  audio?: boolean;
  /** Re-apply navigator/WebGL spoof inside Worker and SharedWorker */
  workers?: boolean;
  navigator?: {
    userAgent?: string;
    language?: string;
    platform?: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
  };
}): string {
  const scripts: string[] = [];

  // Default: all protections enabled
  const opts = {
    webrtc: true,
    canvas: true,
    webgl: true as boolean | WebGLSpoofConfig,
    audio: true,
    workers: true,
    ...options,
  };

  const webglScript = opts.webgl
    ? createWebGLScript(typeof opts.webgl === 'object' ? opts.webgl : {})
    : null;
  const navigatorScript = opts.navigator ? createNavigatorScript(opts.navigator) : null;

  if (opts.webrtc) scripts.push(WEBRTC_PROTECTION_SCRIPT);
  if (opts.canvas) scripts.push(CANVAS_PROTECTION_SCRIPT);
  if (webglScript) scripts.push(webglScript);
  if (opts.audio) scripts.push(AUDIO_PROTECTION_SCRIPT);
  if (navigatorScript) scripts.push(navigatorScript);

  if (opts.workers && (webglScript || navigatorScript)) {
    scripts.push(createWorkerSpoofScript([navigatorScript, webglScript].filter(Boolean).join('\n\n')));
  }

  // Always add automation detection bypass
  scripts.push(AUTOMATION_BYPASS_SCRIPT);

  return scripts.join('\n\n');
}

/**
 * Pick a WebGL vendor/renderer that matches a navigator.platform value
 */
export function pickWebGLForPlatform(platform: string | undefined): Required<WebGLSpoofConfig> {
  const pool = platform?.startsWith('Mac')
    ? WEBGL_RENDERERS.apple
    : platform?.startsWith('Linux')
      ? WEBGL_RENDERERS.linux
      : [...WEBGL_RENDERERS.intel, ...WEBGL_RENDERERS.nvidia, ...WEBGL_RENDERERS.amd];
  const renderer = pool[Math.floor(Math.random() * pool.length)];
  const vendorName = renderer.match(/^ANGLE \(([^,]+),/)?.[1] ?? 'Google';
  return { vendor: `Google Inc. (${vendorName})`, renderer };
}

/**
 * Automation detection bypass script
 * Hides traces of Puppeteer/Playwright automation
 */
export const AUTOMATION_BYPASS_SCRIPT = `
(function() {
  // ===== CDP BINDING DETECTION EVASION =====
  // Remove CDP bindings that are injected by Puppeteer
  const cdpBindings = [
    '__puppeteer_utility_world__',
    '__puppeteer_evaluation_script__',
    '__CDP_BINDING__',
    'cdc_adoQpoasnfa76pfcZLmcfl_Array',
    'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
    'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
    '__driver_evaluate',
    '__webdriver_evaluate',
    '__selenium_evaluate',
    '__fxdriver_evaluate',
    '__driver_unwrapped',
    '__webdriver_unwrapped',
    '__selenium_unwrapped',
    '__fxdriver_unwrapped',
    '_Selenium_IDE_Recorder',
    '_selenium',
    'calledSelenium',
    '$chrome_asyncScriptInfo',
    '$cdc_asdjflasutopfhvcZLmcfl_',
    '__$webdriverAsyncExecutor'
  ];
  
  cdpBindings.forEach(binding => {
    try {
      if (binding in window) {
        delete window[binding];
      }
    } catch {}
  });
  
  // Hide document automation properties
  const docProps = ['webdriver', '$cdc_asdjflasutopfhvcZLmcfl_', '$chrome_asyncScriptInfo'];
  docProps.forEach(prop => {
    try {
      if (prop in document) {
        Object.defineProperty(document, prop, { get: () => undefined });
      }
    } catch {}
  });
  
  // ===== WEBDRIVER REMOVAL =====
  // Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false, // Return false instead of undefined (more natural)
    configurable: true
  });
  
  // Remove automation-related properties from navigator prototype
  try {
    delete Object.getPrototypeOf(navigator).webdriver;
  } catch {}
  
  // ===== CHROME OBJECT FIX =====
  if (!window.chrome) {
    window.chrome = {};
  }
  
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {},
      id: undefined
    };
  }
  
  // Fix chrome.csi for automation detection
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        startE: Date.now(),
        onloadT: Date.now() + 100,
        pageT: Date.now() + 150,
        tran: 15
      };
    };
  }
  
  // Fix chrome.loadTimes for automation detection
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000,
        connectionInfo: "http/1.1",
        finishDocumentLoadTime: Date.now() / 1000 + 0.1,
        finishLoadTime: Date.now() / 1000 + 0.2,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 + 0.05,
        navigationType: "Other",
        npnNegotiatedProtocol: "unknown",
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.3,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false
      };
    };
  }
  
  // ===== CDP DETECTION EVASION =====
  // Hide Error.stack traces that reveal puppeteer/CDP
  const originalError = Error;
  window.Error = function(...args) {
    const error = new originalError(...args);
    Object.defineProperty(error, 'stack', {
      get: function() {
        const stack = originalError.prototype.stack;
        if (typeof stack === 'string') {
          // Remove puppeteer/CDP related traces
          return stack
            .split('\\n')
            .filter(line => 
              !line.includes('puppeteer') && 
              !line.includes('CDP') &&
              !line.includes('__puppeteer') &&
              !line.includes('devtools')
            )
            .join('\\n');
        }
        return stack;
      }
    });
    return error;
  };
  window.Error.prototype = originalError.prototype;
  
  // ===== PERMISSIONS API =====
  const originalQuery = navigator.permissions && navigator.permissions.query ? 
    navigator.permissions.query.bind(navigator.permissions) : null;
  
  if (navigator.permissions) {
    navigator.permissions.query = function(parameters) {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return originalQuery ? originalQuery(parameters) : Promise.resolve({ state: 'prompt', onchange: null });
    };
  }
  
  // ===== PLUGINS FIX =====
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 1 },
    { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: '', length: 1 },
    { name: 'Microsoft Edge PDF Plugin', filename: 'edge-pdf-viewer', description: 'PDF', length: 1 }
  ];
  fakePlugins.item = (i) => fakePlugins[i];
  fakePlugins.namedItem = (name) => fakePlugins.find(p => p.name === name);
  fakePlugins.refresh = () => {};
  
  Object.defineProperty(navigator, 'plugins', {
    get: () => fakePlugins,
    configurable: true
  });
  
  // ===== CONNECTION API =====
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
      type: 'wifi',
      onchange: null
    }),
    configurable: true
  });
  
  // ===== BATTERY API =====
  navigator.getBattery = () => Promise.resolve({
    charging: true,
    chargingTime: 0,
    dischargingTime: Infinity,
    level: 0.95 + Math.random() * 0.05, // Slight variation
    onchargingchange: null,
    onchargingtimechange: null,
    ondischargingtimechange: null,
    onlevelchange: null
  });
  
  // ===== MEDIA DEVICES =====
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async function() {
      const devices = await originalEnumerateDevices();
      // Return at least some devices to appear real
      if (devices.length === 0) {
        return [
          { deviceId: 'default', groupId: 'default', kind: 'audioinput', label: '' },
          { deviceId: 'default', groupId: 'default', kind: 'audiooutput', label: '' },
          { deviceId: 'default', groupId: 'default', kind: 'videoinput', label: '' }
        ];
      }
      return devices;
    };
  }
  
  // ===== IFRAME CONTENTWINDOW FIX =====
  // Some detection checks if iframes have accessible contentWindow
  const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  if (originalContentWindow) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function() {
        const w = originalContentWindow.get.call(this);
        if (w && this.src && this.src.startsWith('about:')) {
          return w;
        }
        return w;
      }
    });
  }
  
  // ===== OUTERWIDTH/HEIGHT FIX =====
  // Bot detection sometimes checks if window dimensions are suspicious
  if (window.outerWidth === 0 || window.outerHeight === 0) {
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth + 16, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 88, configurable: true });
  }
  
  console.log('[browser-profiles] Automation bypass enabled');
})();
`;

/**
 * Screen resolution spoofing script
 */
export function createScreenScript(config: {
  width?: number;
  height?: number;
  availWidth?: number;
  availHeight?: number;
  colorDepth?: number;
  pixelDepth?: number;
  devicePixelRatio?: number;
}): string {
  const width = config.width || 1920;
  const height = config.height || 1080;
  const availWidth = config.availWidth || width;
  const availHeight = config.availHeight || height - 40; // Account for taskbar
  const colorDepth = config.colorDepth || 24;
  const pixelDepth = config.pixelDepth || 24;
  const devicePixelRatio = config.devicePixelRatio || 1;

  return `
(function() {
  // Spoof screen dimensions
  Object.defineProperty(screen, 'width', { get: () => ${width}, configurable: true });
  Object.defineProperty(screen, 'height', { get: () => ${height}, configurable: true });
  Object.defineProperty(screen, 'availWidth', { get: () => ${availWidth}, configurable: true });
  Object.defineProperty(screen, 'availHeight', { get: () => ${availHeight}, configurable: true });
  Object.defineProperty(screen, 'colorDepth', { get: () => ${colorDepth}, configurable: true });
  Object.defineProperty(screen, 'pixelDepth', { get: () => ${pixelDepth}, configurable: true });
  
  // Spoof window dimensions to match
  Object.defineProperty(window, 'outerWidth', { get: () => ${width}, configurable: true });
  Object.defineProperty(window, 'outerHeight', { get: () => ${height}, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { get: () => ${devicePixelRatio}, configurable: true });
  
  console.log('[browser-profiles] Screen spoofing enabled: ${width}x${height}');
})();
`;
}

/**
 * User-Agent data spoofing for Client Hints API (sec-ch-ua headers)
 */
export function createClientHintsScript(config: {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  model?: string;
  mobile?: boolean;
  brands?: Array<{ brand: string; version: string }>;
}): string {
  const platform = config.platform || 'Windows';
  const platformVersion = config.platformVersion || '10.0.0';
  const architecture = config.architecture || 'x86';
  const model = config.model || '';
  const mobile = config.mobile || false;
  const brands = config.brands || [
    { brand: 'Chromium', version: '120' },
    { brand: 'Google Chrome', version: '120' },
    { brand: 'Not_A Brand', version: '8' }
  ];

  const brandsJSON = JSON.stringify(brands);

  return `
(function() {
  // Spoof NavigatorUAData for Client Hints API
  if (navigator.userAgentData) {
    const spoofedUserAgentData = {
      brands: ${brandsJSON},
      mobile: ${mobile},
      platform: '${platform}',
      getHighEntropyValues: function(hints) {
        return Promise.resolve({
          brands: ${brandsJSON},
          mobile: ${mobile},
          platform: '${platform}',
          platformVersion: '${platformVersion}',
          architecture: '${architecture}',
          model: '${model}',
          uaFullVersion: '120.0.6099.71',
          fullVersionList: ${brandsJSON}
        });
      },
      toJSON: function() {
        return {
          brands: ${brandsJSON},
          mobile: ${mobile},
          platform: '${platform}'
        };
      }
    };
    
    Object.defineProperty(navigator, 'userAgentData', {
      get: () => spoofedUserAgentData,
      configurable: true
    });
  }
  
  console.log('[browser-profiles] Client Hints spoofing enabled: ${platform}');
})();
`;
}

// ============================================================================
// Fingerprint Generation
// ============================================================================

/**
 * User agent data for different platforms
 */
const USER_AGENTS = {
  windows: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  ],
  macos: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ],
};

/**
 * Screen resolutions for different platforms
 */
const SCREEN_RESOLUTIONS = {
  desktop: [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 },
  ],
  laptop: [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
  ],
  retina: [
    { width: 2880, height: 1800 },
    { width: 3024, height: 1964 },
  ],
};

/**
 * WebGL renderers for different GPU vendors
 */
const WEBGL_RENDERERS = {
  intel: [
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 640 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
  ],
  nvidia: [
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)',
  ],
  amd: [
    'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0)',
    'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0)',
  ],
  apple: [
    'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
    'ANGLE (Apple, Apple M2, OpenGL 4.1)',
    'ANGLE (Apple, Apple M1 Max, OpenGL 4.1)',
  ],
  linux: [
    'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
    'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 6600 (radeonsi, navi23, LLVM 15.0.7), OpenGL 4.6)',
  ],
};

/**
 * Options for generating a fingerprint
 */
export interface GenerateFingerprintOptions {
  /**
   * Target platform
   * @default 'random'
   */
  platform?: 'windows' | 'macos' | 'linux' | 'random';

  /**
   * Chrome version to use
   * @default 'latest'
   */
  browser?: 'chrome' | 'edge' | 'brave';

  /**
   * Browser version (major)
   * @default random between 118-122
   */
  version?: number;

  /**
   * Screen type
   * @default 'random'
   */
  screen?: 'desktop' | 'laptop' | 'retina' | 'random';

  /**
   * GPU vendor preference
   * @default 'random'
   */
  gpu?: 'intel' | 'nvidia' | 'amd' | 'apple' | 'random';

  /**
   * Language/Locale
   * @default 'en-US'
   */
  language?: string;

  /**
   * Timezone
   */
  timezone?: string;

  /**
   * Custom overrides (will override generated values)
   */
  overrides?: Partial<GeneratedFingerprint>;
}

/**
 * Generated fingerprint data
 */
export interface GeneratedFingerprint {
  // Navigator properties
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  hardwareConcurrency: number;
  deviceMemory: number;
  vendor: string;

  // Screen properties
  screen: {
    width: number;
    height: number;
    availWidth: number;
    availHeight: number;
    colorDepth: number;
    pixelDepth: number;
    devicePixelRatio: number;
  };

  // WebGL properties
  webgl: {
    vendor: string;
    renderer: string;
  };

  // Client hints
  clientHints: {
    platform: string;
    platformVersion: string;
    architecture: string;
    mobile: boolean;
    brands: Array<{ brand: string; version: string }>;
  };

  // Metadata
  meta: {
    generatedAt: Date;
    seed: string;
  };
}

/**
 * Generate a complete browser fingerprint profile
 * 
 * Creates a realistic, consistent fingerprint that can be used for
 * anti-detect browsing without creating a persistent profile.
 * 
 * @example Random fingerprint
 * ```typescript
 * import { generateFingerprint } from '@aitofy/browser-profiles';
 * 
 * const fp = generateFingerprint();
 * console.log(fp.userAgent);
 * console.log(fp.screen);
 * console.log(fp.webgl);
 * ```
 * 
 * @example Specific platform
 * ```typescript
 * const fp = generateFingerprint({
 *   platform: 'windows',
 *   gpu: 'nvidia',
 *   screen: 'desktop',
 *   language: 'ja-JP',
 * });
 * ```
 * 
 * @example With custom overrides
 * ```typescript
 * const fp = generateFingerprint({
 *   platform: 'macos',
 *   overrides: {
 *     hardwareConcurrency: 16,
 *     deviceMemory: 32,
 *   },
 * });
 * ```
 */
export function generateFingerprint(options: GenerateFingerprintOptions = {}): GeneratedFingerprint {
  const randomItem = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

  // Generate seed for reproducibility
  const seed = `fp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // Determine platform
  type Platform = 'windows' | 'macos' | 'linux';
  const platforms: Platform[] = ['windows', 'macos', 'linux'];
  const selectedPlatform: Platform = options.platform === 'random' || !options.platform
    ? randomItem(platforms)
    : options.platform;

  // Platform-specific properties
  const platformConfigs = {
    windows: { platform: 'Win32', vendor: 'Google Inc.', gpuDefault: 'intel' as const },
    macos: { platform: 'MacIntel', vendor: 'Google Inc.', gpuDefault: 'apple' as const },
    linux: { platform: 'Linux x86_64', vendor: 'Google Inc.', gpuDefault: 'intel' as const },
  };
  const platformConfig = platformConfigs[selectedPlatform];

  // Get user agent
  const userAgent = randomItem(USER_AGENTS[selectedPlatform]);

  // Determine screen resolution
  type ScreenType = 'desktop' | 'laptop' | 'retina';
  const screenTypes: ScreenType[] = ['desktop', 'laptop', 'retina'];
  const selectedScreen: ScreenType = options.screen === 'random' || !options.screen
    ? randomItem(screenTypes)
    : options.screen;
  const resolution = randomItem(SCREEN_RESOLUTIONS[selectedScreen]);
  const devicePixelRatio = selectedScreen === 'retina' ? 2 : 1;

  // Determine GPU
  type GpuVendor = 'intel' | 'nvidia' | 'amd' | 'apple';
  const selectedGpu: GpuVendor = options.gpu === 'random' || !options.gpu
    ? (selectedPlatform === 'macos' ? 'apple' : platformConfig.gpuDefault)
    : options.gpu;
  const webglRenderer = randomItem(WEBGL_RENDERERS[selectedGpu]);

  // Language
  const language = options.language || 'en-US';
  const languages = [language, language.split('-')[0]];

  // Hardware
  const coreOptions = selectedPlatform === 'macos' ? [8, 10, 12, 16] : [4, 6, 8, 12, 16];
  const memoryOptions = selectedPlatform === 'macos' ? [8, 16, 32, 64] : [4, 8, 16, 32];
  const hardwareConcurrency = randomItem(coreOptions);
  const deviceMemory = randomItem(memoryOptions);

  // Browser version
  const version = options.version || randomInt(118, 122);

  // Client hints
  const clientHintsPlatforms = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
  };
  const clientHintsPlatform = clientHintsPlatforms[selectedPlatform];

  const platformVersions = {
    windows: ['10.0.0', '10.0.19045', '11.0.0'],
    macos: ['14.2.0', '13.6.1', '14.0.0'],
    linux: ['6.5.0', '5.15.0'],
  };

  const fingerprint: GeneratedFingerprint = {
    userAgent,
    platform: platformConfig.platform,
    language,
    languages,
    hardwareConcurrency,
    deviceMemory,
    vendor: platformConfig.vendor,

    screen: {
      width: resolution.width,
      height: resolution.height,
      availWidth: resolution.width,
      availHeight: resolution.height - (selectedPlatform === 'macos' ? 25 : 40),
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio,
    },

    webgl: {
      vendor: 'Google Inc. (ANGLE)',
      renderer: webglRenderer,
    },

    clientHints: {
      platform: clientHintsPlatform,
      platformVersion: randomItem(platformVersions[selectedPlatform]),
      architecture: selectedPlatform === 'macos' ? 'arm' : 'x86',
      mobile: false,
      brands: [
        { brand: 'Chromium', version: String(version) },
        { brand: 'Google Chrome', version: String(version) },
        { brand: 'Not_A Brand', version: '8' },
      ],
    },

    meta: {
      generatedAt: new Date(),
      seed,
    },
  };

  // Apply custom overrides
  if (options.overrides) {
    Object.assign(fingerprint, options.overrides);
  }

  return fingerprint;
}

/**
 * Get all injection scripts for a fingerprint
 * 
 * Convenience function that combines generateFingerprint with script generation
 */
export function getFingerprintScripts(fingerprint: GeneratedFingerprint): string {
  const scripts: string[] = [];

  // Navigator script
  scripts.push(createNavigatorScript({
    language: fingerprint.language,
    platform: fingerprint.platform,
    hardwareConcurrency: fingerprint.hardwareConcurrency,
    deviceMemory: fingerprint.deviceMemory,
    vendor: fingerprint.vendor,
  }));

  // Screen script
  scripts.push(createScreenScript({
    width: fingerprint.screen.width,
    height: fingerprint.screen.height,
    availWidth: fingerprint.screen.availWidth,
    availHeight: fingerprint.screen.availHeight,
    colorDepth: fingerprint.screen.colorDepth,
    pixelDepth: fingerprint.screen.pixelDepth,
    devicePixelRatio: fingerprint.screen.devicePixelRatio,
  }));

  // Client hints script
  scripts.push(createClientHintsScript({
    platform: fingerprint.clientHints.platform,
    platformVersion: fingerprint.clientHints.platformVersion,
    architecture: fingerprint.clientHints.architecture,
    mobile: fingerprint.clientHints.mobile,
    brands: fingerprint.clientHints.brands,
  }));

  // Protection scripts
  scripts.push(WEBRTC_PROTECTION_SCRIPT);
  scripts.push(CANVAS_PROTECTION_SCRIPT);
  scripts.push(WEBGL_PROTECTION_SCRIPT);
  scripts.push(AUDIO_PROTECTION_SCRIPT);
  scripts.push(AUTOMATION_BYPASS_SCRIPT);

  return scripts.join('\n\n');
}
