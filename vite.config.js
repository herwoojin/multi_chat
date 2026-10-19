import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 로컬 개발용 Netlify Functions 실행기.
 * `netlify dev` 없이 `npm run dev` 만으로 /api/translate, /api/tts, /api/joinRoom 이 동작한다.
 * 배포 시에는 netlify.toml 의 /api/* → /.netlify/functions/:splat 리다이렉트가 같은 역할을 한다.
 */
function netlifyFunctionsDev() {
  const dir = path.resolve('netlify/functions');
  return {
    name: 'netlify-functions-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const m = url.pathname.match(/^\/(?:api|\.netlify\/functions)\/([\w-]+)\/?$/);
        if (!m) return next();

        const file = path.join(dir, `${m[1]}.js`);
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          return res.end(`function "${m[1]}" not found`);
        }
        try {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const mtime = fs.statSync(file).mtimeMs;
          const mod = await import(`${pathToFileURL(file).href}?t=${mtime}`);
          const r = await mod.handler({
            httpMethod: req.method,
            headers: req.headers,
            path: url.pathname,
            queryStringParameters: Object.fromEntries(url.searchParams),
            body: Buffer.concat(chunks).toString('utf8'),
            isBase64Encoded: false,
          }, {});
          res.statusCode = r?.statusCode || 200;
          for (const [k, v] of Object.entries(r?.headers || {})) res.setHeader(k, v);
          res.end(r?.isBase64Encoded ? Buffer.from(r.body, 'base64') : (r?.body ?? ''));
        } catch (e) {
          console.error(`[functions:${m[1]}]`, e);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(e?.message || e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Functions 가 읽는 서버 전용 환경변수(VITE_ 접두사 없음)를 process.env 로 올려준다.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('VITE_') && process.env[k] === undefined) process.env[k] = v;
  }

  return {
    plugins: [react(), netlifyFunctionsDev()],
    server: { port: 5173, host: true },
    build: {
      rollupOptions: {
        output: {
          manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'] },
        },
      },
    },
  };
});
