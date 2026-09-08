import { readFile, writeFile } from "node:fs/promises";

const [file] = process.argv.slice(2);
if (!file) throw new Error("config path is required");
const required = [
  "CI_SUPABASE_PROJECT_ID",
  "CI_SUPABASE_API_PORT",
  "CI_SUPABASE_DB_PORT",
  "CI_SUPABASE_STUDIO_PORT",
  "CI_SUPABASE_INBUCKET_PORT",
  "CI_SUPABASE_SMTP_PORT",
  "CI_SUPABASE_POP3_PORT",
  "CI_SUPABASE_ANALYTICS_PORT",
];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required`);
let config = await readFile(file, "utf8");
config = config.replace(/^project_id\s*=\s*"[^"]*"/mu, `project_id = "${process.env.CI_SUPABASE_PROJECT_ID}"`);
config = config.replace(/^port\s*=\s*\d+/mu, `port = ${process.env.CI_SUPABASE_API_PORT}`);
config = config.replace(/(\[db\][\s\S]*?\nport\s*=\s*)\d+/u, `$1${process.env.CI_SUPABASE_DB_PORT}`);
config = config.replace(/(\[studio\][\s\S]*?\nport\s*=\s*)\d+/u, `$1${process.env.CI_SUPABASE_STUDIO_PORT}`);
config += `\n[inbucket]\nport = ${process.env.CI_SUPABASE_INBUCKET_PORT}\nsmtp_port = ${process.env.CI_SUPABASE_SMTP_PORT}\npop3_port = ${process.env.CI_SUPABASE_POP3_PORT}\n\n[analytics]\nenabled = true\nport = ${process.env.CI_SUPABASE_ANALYTICS_PORT}\n`;
await writeFile(file, config);
