# Contributing to browser-profiles

Thank you for considering contributing to browser-profiles! 🎉

## Quick Start

```bash
# Clone the repo
git clone https://github.com/aitofy-dev/browser-profiles.git
cd browser-profiles

# Install dependencies
npm install

# Build
npm run build

# Test manually
npx tsx test.ts
```

## Development Workflow

### 1. Fork & Clone

```bash
git clone https://github.com/YOUR-USERNAME/browser-profiles.git
cd browser-profiles
git remote add upstream https://github.com/aitofy-dev/browser-profiles.git
```

### 2. Create a Branch

```bash
git checkout -b feature/my-feature
```

### 3. Make Changes

- Edit files in `src/`
- Run `npm run build` to compile
- Test your changes

### 4. Commit

```bash
git add .
git commit -m "feat: add my feature"
```

Use conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Adding tests

### 5. Push & Create PR

```bash
git push origin feature/my-feature
```

Then open a Pull Request on GitHub.

## Project Structure

```
src/
├── index.ts              # Main exports
├── types.ts              # TypeScript types
├── profile-manager.ts    # Profile CRUD operations
├── chrome-launcher.ts    # Chrome launch + anti-detect
├── fingerprint.ts        # Fingerprint protection scripts
└── integrations/
    ├── puppeteer.ts      # Puppeteer integration
    ├── playwright.ts     # Playwright integration
    └── extower.ts        # ExTower API client
```

## Key Files

| File | Description |
|------|-------------|
| `profile-manager.ts` | Profile create/read/update/delete |
| `chrome-launcher.ts` | Launch Chrome with anti-detect flags |
| `fingerprint.ts` | WebRTC, Canvas, WebGL protection scripts |

## Testing

Currently manual testing:

```typescript
// test.ts
import { quickLaunch } from './src/integrations/puppeteer';

const { page, close } = await quickLaunch({
  proxy: { type: 'http', host: 'proxy.example.com', port: 8080 },
});

await page.goto('https://browserscan.net');
// Check anti-detect score
await close();
```

## Debugging

### Common Issues

#### Chrome not found
```
Error: Chrome not found
```
**Solution**: Install Chrome or set `chromePath` in options.

#### Proxy connection failed
```
Error: Failed to configure proxy
```
**Solution**: Check proxy host/port/auth are correct.

#### WebSocket connection failed
```
Error: Failed to connect to browser
```
**Solution**: Ensure Chrome launched successfully, check port.

### Debug Mode

Enable debug logging:

```typescript
const profiles = new BrowserProfiles({
  debug: true, // Coming soon
});
```

## Code Style

- TypeScript strict mode
- ES modules
- JSDoc comments for public APIs
- Consistent naming (camelCase)

## Questions?

- Open an issue on GitHub
- Check existing issues first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
