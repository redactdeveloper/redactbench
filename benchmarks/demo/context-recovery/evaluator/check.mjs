import { parsePort } from "/workspace/src/parse-port.mjs";
import { formatPort } from "/workspace/src/format-port.mjs";

const scenario = process.argv[2];
const checks = {
  "parse-valid":
    parsePort("1") === 1 &&
    parsePort("443") === 443 &&
    parsePort("65535") === 65535,
  "parse-invalid":
    parsePort("0") === null &&
    parsePort("65536") === null &&
    parsePort("12x") === null &&
    parsePort("1.5") === null &&
    parsePort(80) === null,
  "format-valid": formatPort(1) === ":1" && formatPort(65535) === ":65535",
  "format-invalid":
    formatPort(0) === null &&
    formatPort(65536) === null &&
    formatPort(1.5) === null &&
    formatPort("80") === null
};

if (!scenario || !(scenario in checks) || !checks[scenario]) {
  console.error(`Recovery scenario failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
