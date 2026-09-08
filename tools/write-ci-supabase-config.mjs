import { stat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const [file] = process.argv.slice(2);
if (!file) throw new Error("config path is required");
const configPath = resolve(file);
if (basename(configPath) !== "config.toml" || basename(dirname(configPath)) !== "supabase") {
  throw new Error("config path must be <project-root>/supabase/config.toml");
}
if (!(await stat(resolve(dirname(configPath), "migrations"))).isDirectory()) {
  throw new Error("isolated project must contain supabase/migrations");
}
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
let config = await readFile(configPath, "utf8");
function replaceRequired(input, pattern, replacement, name) {
  if (!pattern.test(input)) throw new Error(`source config is missing ${name}`);
  return input.replace(pattern, replacement);
}
config = replaceRequired(config, /^project_id\s*=\s*"[^"]*"/mu, `project_id = "${process.env.CI_SUPABASE_PROJECT_ID}"`, "project_id");
config = replaceRequired(config, /(\[api\][\s\S]*?\nport\s*=\s*)\d+/u, `$1${process.env.CI_SUPABASE_API_PORT}`, "api.port");
config = replaceRequired(config, /(\[db\][\s\S]*?\nport\s*=\s*)\d+/u, `$1${process.env.CI_SUPABASE_DB_PORT}`, "db.port");
config = replaceRequired(config, /(\[studio\][\s\S]*?\nport\s*=\s*)\d+/u, `$1${process.env.CI_SUPABASE_STUDIO_PORT}`, "studio.port");
config += `\n[inbucket]\nport = ${process.env.CI_SUPABASE_INBUCKET_PORT}\nsmtp_port = ${process.env.CI_SUPABASE_SMTP_PORT}\npop3_port = ${process.env.CI_SUPABASE_POP3_PORT}\n\n[analytics]\nenabled = true\nport = ${process.env.CI_SUPABASE_ANALYTICS_PORT}\n`;
await writeFile(configPath, config);
