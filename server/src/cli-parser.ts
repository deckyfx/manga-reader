/**
 * What the server was asked to do, before it does any of it.
 *
 * Parsing happens before anything is set up, so `--help` answers instantly and a first run can offer to write its
 * settings rather than starting with defaults nobody chose.
 */

export type CliResult =
  | { type: "help" }
  | { type: "version" }
  /** Write the settings file, then stop — for changing one's mind later. */
  | { type: "setup" }
  /** Say what this machine can and cannot run, then stop. */
  | { type: "doctor" }
  /** Start the server, asking the setup questions first if there are no settings and somebody is watching. */
  | { type: "serve" };

/** ANSI colour, or nothing at all when this isn't a terminal (piped output, a log file, a service manager). */
function colour(css: string): string {
  if (!process.stdout.isTTY) return "";
  return Bun.color(css, "ansi") ?? "";
}

const RESET = process.stdout.isTTY ? "\x1b[0m" : "";
const BOLD = process.stdout.isTTY ? "\x1b[1m" : "";

export function printUsage(): void {
  const cyan = colour("cyan");
  const green = colour("green");
  const gray = colour("gray");

  console.log(`
${BOLD}web-ocr${RESET} — OCR, translation and a Studio for manga pages

${BOLD}Usage:${RESET}
  ${cyan}app${RESET}                  Start the server (offers to set it up on a first run)
  ${cyan}app --setup${RESET}          Answer the setup questions again and write .env
  ${cyan}app --doctor${RESET}         Check this machine: libraries, models, fonts, folders
  ${cyan}app --help${RESET}           Show this
  ${cyan}app --version${RESET}        Print the version

${BOLD}Settings${RESET} come from ${green}.env${RESET} in the directory you start it from, and from the environment.
Everything it stores — the database, the models, the pages, the logs — lives under ${green}DATA_DIR${RESET} (./data).

${BOLD}Examples:${RESET}
  ${gray}# First run: it asks a few questions, writes .env, then starts${RESET}
  ./app

  ${gray}# Somewhere unattended: no questions, defaults and the environment decide${RESET}
  PORT=8080 DATA_DIR=/var/lib/web-ocr ./app

  ${gray}# Before asking why it won't work${RESET}
  ./app --doctor
`);
}

/** Reads the arguments. Never throws: an unknown one is not worth refusing to start over. */
export function parseCli(argv: readonly string[] = Bun.argv): CliResult {
  if (argv.includes("-h") || argv.includes("--help")) return { type: "help" };
  if (argv.includes("-V") || argv.includes("--version")) return { type: "version" };
  if (argv.includes("--setup")) return { type: "setup" };
  if (argv.includes("--doctor")) return { type: "doctor" };
  return { type: "serve" };
}
