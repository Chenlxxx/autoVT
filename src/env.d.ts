declare const process: {
  cwd(): string;
  exit(code?: number): never;
  env: Record<string, string | undefined>;
};

declare const __dirname: string;

declare module "playwright" {
  export type Locator = any;
  export type Page = any;
  export const chromium: any;
}

declare module "react" {
  export const StrictMode: any;
  export function useEffect(effect: any, deps?: any[]): void;
  export function useMemo<T>(factory: () => T, deps?: any[]): T;
  export function useState<T>(initial: T): [T, (value: T | ((prev: T) => T)) => void];
  const React: any;
  export default React;
}

declare module "react-dom/client" {
  export function createRoot(element: any): { render(node: any): void };
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module "motion/react" {
  export const motion: any;
  export const AnimatePresence: any;
}

declare module "path" {
  const path: any;
  export default path;
}

declare module "fs" {
  export function createReadStream(path: string): any;
}

declare module "fs/promises" {
  const fs: any;
  export default fs;
}

declare module "url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "crypto" {
  export function randomUUID(): string;
}

declare module "http" {
  export function createServer(handler: any): {
    listen(port: number, host: string, cb?: () => void): void;
    once(event: string, cb: any): void;
    off(event: string, cb: any): void;
    close(): void;
  };
  export type IncomingMessage = any;
  export type ServerResponse = any;
}

declare const Buffer: any;

declare module "fs-extra" {
  const fs: any;
  export default fs;
}

declare module "express" {
  const express: any;
  export default express;
}

declare module "vite" {
  export const createServer: any;
  export function defineConfig(config: any): any;
  export function loadEnv(mode: string, envDir: string, prefixes?: string | string[]): Record<string, string>;
}

declare module "@vitejs/plugin-react" {
  const react: any;
  export default react;
}

declare module "@tailwindcss/vite" {
  const tailwindcss: any;
  export default tailwindcss;
}

declare module "openai" {
  const OpenAI: any;
  export default OpenAI;
}
