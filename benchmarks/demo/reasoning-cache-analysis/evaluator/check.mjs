import { readFile } from "node:fs/promises";

const scenario = process.argv[2];
const answer = (await readFile(process.env.REDACTBENCH_RESPONSE_FILE, "utf8")).toLowerCase();

const checks = {
  cause:
    answer.includes("tenant") &&
    /(?:cache|key|collision)/u.test(answer) &&
    /(?:user\s*id|userid|user_id)/u.test(answer) &&
    /(?:only|omit|ignor|missing|without|same)/u.test(answer),
  evidence:
    answer.includes("cache.mjs") &&
    answer.includes("service.mjs") &&
    /(?:getcacheduser|cacheuser)/u.test(answer) &&
    answer.includes("loaduser"),
  fix:
    answer.includes("key") &&
    /(?:composite|pair|both|include|add)/u.test(answer) &&
    answer.includes("tenant") &&
    /(?:user\s*id|userid|user_id)/u.test(answer),
  regression:
    /(?:test|assert)/u.test(answer) &&
    /(?:two tenants|2 tenants|tenant-a|tenant a)/u.test(answer) &&
    /same (?:user\s*)?id/u.test(answer) &&
    /(?:distinct|different|separate|not (?:return|reuse)|does not (?:return|reuse))/u.test(
      answer
    )
};

if (!scenario || !(scenario in checks) || !checks[scenario]) {
  console.error(`Reasoning evidence failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
